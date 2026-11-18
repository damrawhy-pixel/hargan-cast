// SPDX-License-Identifier: AGPL-3.0-only
import AVFoundation
import CoreMedia
import Foundation
import HarganPsCoreC
import QuartzCore
import UIKit
import VideoToolbox
import WebKit

/// The stream's picture decoded by VideoToolbox and shown on an
/// AVSampleBufferDisplayLayer under the (then transparent) web view. The frame
/// never passes through the web view's compositor, which saves its copy and its
/// frame of delay. The core hands over Annex B access units (hc_core_set_video);
/// sound and input stay on the media socket. The iOS side of NativeVideo.java.
final class NativeVideo {
    typealias StatsHandler = (_ fps: Int, _ decodeMs: Double, _ bytes: Int, _ width: Int, _ height: Int, _ first: Bool) -> Void

    // The core calls from the session's threads, and reaches the picture through this.
    private static let lock = NSLock()
    private static var current: NativeVideo?

    private let width: Int
    private let height: Int
    private let onStats: StatsHandler
    private weak var webView: WKWebView?
    private var view: DisplayView?
    private var previousOpaque = true
    private var previousBackground: UIColor?
    private var previousScrollBackground: UIColor?

    // Touched only on `queue`.
    private let queue = DispatchQueue(label: "app.hargan.video", qos: .userInteractive)
    private let decoder: VideoDecoder
    private var layer: AVSampleBufferDisplayLayer?
    private var running = false
    private var waitingForKey = true
    private var shownFirst = false
    private var shownFormat: CMVideoFormatDescription?
    private var frames = 0
    private var decodeSum = 0.0
    private var bytes = 0
    private var statsAt = CACurrentMediaTime()

    // Frames handed to `queue` and not decoded yet; the core's threads read it too.
    private let backlogLock = NSLock()
    private var backlog = 0

    init(webView: WKWebView?, hevc: Bool, width: Int, height: Int, onStats: @escaping StatsHandler) {
        self.webView = webView
        self.width = width
        self.height = height
        self.onStats = onStats
        decoder = VideoDecoder(hevc: hevc)
    }

    /// Puts the picture under the web view, then takes the stream's video from the core.
    func start() {
        DispatchQueue.main.async { [self] in
            guard let webView else { return }
            let view = DisplayView(frame: webView.bounds)
            view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
            view.backgroundColor = .black
            view.isUserInteractionEnabled = false
            // The picture keeps its shape, centred, like the app's own "keep aspect ratio".
            view.displayLayer.videoGravity = .resizeAspect
            webView.insertSubview(view, at: 0)
            previousOpaque = webView.isOpaque
            previousBackground = webView.backgroundColor
            previousScrollBackground = webView.scrollView.backgroundColor
            webView.isOpaque = false
            webView.backgroundColor = .clear
            webView.scrollView.backgroundColor = .clear
            self.view = view
            let layer = view.displayLayer
            queue.async { [self] in
                self.layer = layer
                running = true
                waitingForKey = true
                statsAt = CACurrentMediaTime()
                NativeVideo.lock.lock()
                NativeVideo.current = self
                NativeVideo.lock.unlock()
                // Setting the sink makes the core send a key frame first.
                hc_core_set_video(videoFromCore, nil)
            }
        }
    }

    func stop() {
        hc_core_set_video(nil, nil)
        NativeVideo.lock.lock()
        if NativeVideo.current === self { NativeVideo.current = nil }
        NativeVideo.lock.unlock()
        queue.async { [self] in
            running = false
            decoder.reset()
            layer?.flushAndRemoveImage()
            layer = nil
        }
        DispatchQueue.main.async { [self] in
            guard let view else { return }
            view.removeFromSuperview()
            self.view = nil
            if let webView {
                webView.isOpaque = previousOpaque
                webView.backgroundColor = previousBackground
                webView.scrollView.backgroundColor = previousScrollBackground
            }
        }
    }

    fileprivate static func feed(_ data: UnsafePointer<UInt8>, _ size: Int, _ key: Bool) {
        lock.lock()
        let target = current
        lock.unlock()
        // The core frees its buffer when this returns.
        target?.feed(Array(UnsafeBufferPointer(start: data, count: size)), key: key)
    }

    private func feed(_ data: [UInt8], key: Bool) {
        backlogLock.lock()
        let behind = backlog >= 2
        if !behind { backlog += 1 }
        backlogLock.unlock()
        if behind {
            // The decoder is behind: skip to the next key frame rather than fall further back.
            queue.async { [self] in
                bytes += data.count
                waitingForKey = true
            }
            hc_core_request_key_frame()
            return
        }
        queue.async { [self] in
            decode(data, key: key)
            backlogLock.lock()
            backlog -= 1
            backlogLock.unlock()
        }
    }

    private func decode(_ data: [UInt8], key: Bool) {
        guard running, let layer else { return }
        bytes += data.count
        if waitingForKey {
            if !key { return }
            waitingForKey = false
        }
        if layer.status == .failed {
            // Interrupted, for one when the app went to the background: start again from a key frame.
            layer.flush()
            if !key { return lost() }
        }
        let started = CACurrentMediaTime()
        guard let image = decoder.decode(data) else { return lost() }
        decodeSum += (CACurrentMediaTime() - started) * 1000
        frames += 1
        show(image, on: layer)
        if !shownFirst {
            shownFirst = true
            onStats(0, 0, 0, width, height, true)
        }
        let now = CACurrentMediaTime()
        if now - statsAt >= 1 {
            onStats(frames, frames > 0 ? decodeSum / Double(frames) : 0, bytes, width, height, false)
            frames = 0
            decodeSum = 0
            bytes = 0
            statsAt = now
        }
    }

    private func lost() {
        waitingForKey = true
        hc_core_request_key_frame()
    }

    private func show(_ image: CVImageBuffer, on layer: AVSampleBufferDisplayLayer) {
        if shownFormat.map({ !CMVideoFormatDescriptionMatchesImageBuffer($0, imageBuffer: image) }) ?? true {
            var created: CMVideoFormatDescription?
            _ = CMVideoFormatDescriptionCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: image, formatDescriptionOut: &created)
            shownFormat = created
        }
        guard let format = shownFormat else { return }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?
        guard CMSampleBufferCreateReadyWithImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: image, formatDescription: format, sampleTiming: &timing, sampleBufferOut: &sample) == noErr,
              let sample else { return }
        // Shown at once: a game stream wants the newest frame, not an even cadence.
        if let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: true), CFArrayGetCount(attachments) > 0 {
            let dictionary = unsafeBitCast(CFArrayGetValueAtIndex(attachments, 0), to: CFMutableDictionary.self)
            let yes: CFBoolean = kCFBooleanTrue
            CFDictionarySetValue(dictionary, Unmanaged.passUnretained(kCMSampleAttachmentKey_DisplayImmediately).toOpaque(), Unmanaged.passUnretained(yes).toOpaque())
        }
        layer.enqueue(sample)
    }

    /// Decodes a short clip without a screen, to learn whether this device's decoder
    /// takes the stream's format.
    static func selfTest(_ units: [[UInt8]], hevc: Bool) -> [String: Any] {
        let decoder = VideoDecoder(hevc: hevc)
        var decoded = 0
        for unit in units where decoder.decode(unit) != nil {
            decoded += 1
        }
        decoder.reset()
        #if targetEnvironment(simulator)
        let hardware = false
        #else
        let hardware = true
        #endif
        return ["decoded": decoded, "decoder": "VideoToolbox", "hardware": hardware]
    }
}

/// A view whose own layer is the display layer, so it follows the view's size.
private final class DisplayView: UIView {
    override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }
    // swiftlint:disable:next force_cast
    var displayLayer: AVSampleBufferDisplayLayer { layer as! AVSampleBufferDisplayLayer }
}

/// Annex B access units in, decoded images out, through a VideoToolbox session that
/// follows the stream's parameter sets.
final class VideoDecoder {
    private let hevc: Bool
    private var parameterSets: [[UInt8]] = []
    private var format: CMVideoFormatDescription?
    private var session: VTDecompressionSession?

    init(hevc: Bool) {
        self.hevc = hevc
    }

    func reset() {
        if let session { VTDecompressionSessionInvalidate(session) }
        session = nil
        format = nil
        parameterSets = []
    }

    private func kind(_ header: UInt8) -> UInt8 {
        hevc ? (header >> 1) & 0x3F : header & 0x1F
    }

    // H.264: SPS 7, PPS 8. HEVC: VPS 32, SPS 33, PPS 34.
    private func isParameterSet(_ kind: UInt8) -> Bool {
        hevc ? (32...34).contains(kind) : kind == 7 || kind == 8
    }

    // Access unit delimiters carry nothing the decoder needs.
    private func isDelimiter(_ kind: UInt8) -> Bool {
        hevc ? kind == 35 : kind == 9
    }

    /// One access unit; nil when it could not be decoded.
    func decode(_ data: [UInt8]) -> CVImageBuffer? {
        var sets: [[UInt8]] = []
        var payload: [UInt8] = []
        payload.reserveCapacity(data.count + 16)
        data.withUnsafeBufferPointer { buffer in
            for range in VideoDecoder.units(buffer) where !range.isEmpty {
                let type = kind(buffer[range.lowerBound])
                if isParameterSet(type) {
                    sets.append(Array(buffer[range]))
                } else if !isDelimiter(type) {
                    // AVCC form: each unit led by its length, 4 bytes big endian.
                    let length = UInt32(range.count).bigEndian
                    withUnsafeBytes(of: length) { payload.append(contentsOf: $0) }
                    payload.append(contentsOf: buffer[range])
                }
            }
        }
        if !sets.isEmpty && sets != parameterSets && !configure(sets) { return nil }
        guard let session, let format, !payload.isEmpty, let sample = VideoDecoder.sample(payload, format: format) else { return nil }
        var image: CVImageBuffer?
        // Without the asynchronous flag the frame is out before this returns.
        let status = VTDecompressionSessionDecodeFrame(session, sampleBuffer: sample, flags: [], infoFlagsOut: nil,
                                                       outputHandler: { result, _, buffer, _, _ in
            if result == noErr { image = buffer }
        })
        if status != noErr {
            // A session the system took away (the app went to the background) is made
            // again from the next key frame's parameter sets.
            reset()
            return nil
        }
        return image
    }

    private func configure(_ sets: [[UInt8]]) -> Bool {
        reset()
        // One of each kind, in the order the format description wants them.
        let order: [UInt8] = hevc ? [32, 33, 34] : [7, 8]
        let ordered = order.compactMap { wanted in sets.first { !$0.isEmpty && kind($0[0]) == wanted } }
        guard ordered.count == order.count else { return false }
        var created: CMFormatDescription?
        let status = VideoDecoder.withPointers(ordered) { pointers, sizes -> OSStatus in
            if hevc {
                return CMVideoFormatDescriptionCreateFromHEVCParameterSets(
                    allocator: kCFAllocatorDefault, parameterSetCount: pointers.count, parameterSetPointers: pointers,
                    parameterSetSizes: sizes, nalUnitHeaderLength: 4, extensions: nil, formatDescriptionOut: &created)
            }
            return CMVideoFormatDescriptionCreateFromH264ParameterSets(
                allocator: kCFAllocatorDefault, parameterSetCount: pointers.count, parameterSetPointers: pointers,
                parameterSetSizes: sizes, nalUnitHeaderLength: 4, formatDescriptionOut: &created)
        }
        guard status == noErr, let created else { return false }
        let attributes = [kCVPixelBufferIOSurfacePropertiesKey as String: [String: Any]()] as CFDictionary
        var made: VTDecompressionSession?
        guard VTDecompressionSessionCreate(allocator: kCFAllocatorDefault, formatDescription: created, decoderSpecification: nil,
                                           imageBufferAttributes: attributes, outputCallback: nil, decompressionSessionOut: &made) == noErr,
              let made else { return false }
        // Realtime: decode each frame as soon as it arrives.
        _ = VTSessionSetProperty(made, key: kVTDecompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        format = created
        session = made
        parameterSets = sets
        return true
    }

    private static func withPointers<R>(_ sets: [[UInt8]], _ body: ([UnsafePointer<UInt8>], [Int]) -> R) -> R {
        let buffers = sets.map { set -> UnsafeMutablePointer<UInt8> in
            let pointer = UnsafeMutablePointer<UInt8>.allocate(capacity: set.count)
            pointer.initialize(from: set, count: set.count)
            return pointer
        }
        defer { buffers.forEach { $0.deallocate() } }
        return body(buffers.map { UnsafePointer($0) }, sets.map(\.count))
    }

    private static func sample(_ payload: [UInt8], format: CMVideoFormatDescription) -> CMSampleBuffer? {
        var block: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil, blockLength: payload.count,
                                                 blockAllocator: kCFAllocatorDefault, customBlockSource: nil, offsetToData: 0,
                                                 dataLength: payload.count, flags: kCMBlockBufferAssureMemoryNowFlag,
                                                 blockBufferOut: &block) == kCMBlockBufferNoErr,
              let block else { return nil }
        let copied = payload.withUnsafeBytes { bytes in
            CMBlockBufferReplaceDataBytes(with: bytes.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: payload.count)
        }
        guard copied == kCMBlockBufferNoErr else { return nil }
        var sample: CMSampleBuffer?
        var size = payload.count
        guard CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format, sampleCount: 1,
                                        sampleTimingEntryCount: 0, sampleTimingArray: nil, sampleSizeEntryCount: 1,
                                        sampleSizeArray: &size, sampleBufferOut: &sample) == noErr else { return nil }
        return sample
    }

    /// The NAL units of an Annex B buffer, without their start codes.
    static func units(_ data: UnsafeBufferPointer<UInt8>) -> [Range<Int>] {
        var units: [Range<Int>] = []
        var start = -1
        var i = 0
        let count = data.count
        while i + 2 < count {
            if data[i] == 0 && data[i + 1] == 0 && data[i + 2] == 1 {
                if start >= 0 {
                    // A four-byte start code leaves its first zero behind the previous unit.
                    var end = i
                    while end > start && data[end - 1] == 0 { end -= 1 }
                    units.append(start..<end)
                }
                i += 3
                start = i
            } else {
                i += 1
            }
        }
        if start >= 0 && start < count { units.append(start..<count) }
        return units
    }
}

/// Called by the core from the session's threads with one access unit.
private func videoFromCore(_ data: UnsafePointer<UInt8>?, _ size: Int, _ key: Bool, _ user: UnsafeMutableRawPointer?) {
    guard let data, size > 0 else { return }
    NativeVideo.feed(data, size, key)
}
