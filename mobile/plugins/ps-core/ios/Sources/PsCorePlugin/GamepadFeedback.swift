// SPDX-License-Identifier: AGPL-3.0-only
//
// What a game asks of the controller, played on the one paired with the iPhone
// or iPad: DualSense adaptive triggers, rumble, the light bar colour, and the
// controller's motion fed back to the stream. The trigger translation is adapted
// from AGPL-3.0 code listed in NOTICE.md.
import CoreHaptics
import Foundation
import GameController
import HarganPsCoreC

final class GamepadFeedback {
    static let shared = GamepadFeedback()

    // Rumble from a PlayStation game lasts until the next change.
    private static let holdSeconds: TimeInterval = 10

    private var engine: CHHapticEngine?
    private var player: CHHapticPatternPlayer?
    private weak var engineController: GCController?
    private var motionOn = false
    private weak var motionController: GCController?

    private init() {
        NotificationCenter.default.addObserver(forName: .GCControllerDidConnect, object: nil, queue: .main) { [weak self] _ in
            self?.followController()
        }
        NotificationCenter.default.addObserver(forName: .GCControllerDidDisconnect, object: nil, queue: .main) { [weak self] _ in
            self?.followController()
        }
    }

    private var controller: GCController? {
        GCController.current ?? GCController.controllers().first
    }

    // MARK: - From the core (any thread)

    func feedback(kind: Int32, data: [UInt8]) {
        DispatchQueue.main.async {
            switch Int(kind) {
            case Int(HC_FEEDBACK_RUMBLE) where data.count >= 2:
                self.rumble(left: data[0], right: data[1], seconds: GamepadFeedback.holdSeconds)
            case Int(HC_FEEDBACK_TRIGGERS) where data.count >= 22:
                self.triggers(typeLeft: data[0], left: Array(data[1..<11]), typeRight: data[11], right: Array(data[12..<22]))
            case Int(HC_FEEDBACK_LIGHT) where data.count >= 3:
                self.controller?.light?.color = GCColor(red: Float(data[0]) / 255, green: Float(data[1]) / 255, blue: Float(data[2]) / 255)
            case Int(HC_FEEDBACK_RESET):
                self.rumble(left: 0, right: 0, seconds: 0)
                self.resetTriggers()
            default:
                break
            }
        }
    }

    // MARK: - Rumble

    /// left is the strong, low-frequency motor, right the light one; 0-255.
    func rumble(left: UInt8, right: UInt8, seconds: TimeInterval) {
        try? player?.stop(atTime: CHHapticTimeImmediate)
        player = nil
        let level = max(left, right)
        guard level > 0, seconds > 0, let engine = hapticEngine() else { return }
        // The strong motor reads as a duller rumble, the light one as a sharper buzz.
        let sharpness: Float = left >= right ? 0.3 : 0.7
        do {
            let event = CHHapticEvent(
                eventType: .hapticContinuous,
                parameters: [
                    CHHapticEventParameter(parameterID: .hapticIntensity, value: max(0.1, Float(level) / 255)),
                    CHHapticEventParameter(parameterID: .hapticSharpness, value: sharpness),
                ],
                relativeTime: 0,
                duration: seconds)
            let pattern = try CHHapticPattern(events: [event], parameters: [])
            let next = try engine.makePlayer(with: pattern)
            try next.start(atTime: CHHapticTimeImmediate)
            player = next
        } catch {
            player = nil
        }
    }

    private func hapticEngine() -> CHHapticEngine? {
        let current = controller
        if engine != nil, engineController === current { return engine }
        engine?.stop(completionHandler: nil)
        engine = nil
        guard let current, let made = current.haptics?.createEngine(withLocality: .default) else { return nil }
        made.resetHandler = { [weak self] in try? self?.engine?.start() }
        do {
            try made.start()
        } catch {
            return nil
        }
        engine = made
        engineController = current
        return made
    }

    // MARK: - Adaptive triggers

    private enum Effect {
        static let off: UInt8 = 0x00
        static let simpleFeedback: UInt8 = 0x01
        static let simpleWeapon: UInt8 = 0x02
        static let off2: UInt8 = 0x05
        static let simpleVibration: UInt8 = 0x06
        static let feedback: UInt8 = 0x21
        static let bow: UInt8 = 0x22
        static let galloping: UInt8 = 0x23
        static let weapon: UInt8 = 0x25
        static let vibration: UInt8 = 0x26
        static let machine: UInt8 = 0x27
    }

    private func triggers(typeLeft: UInt8, left: [UInt8], typeRight: UInt8, right: [UInt8]) {
        guard let pad = controller?.extendedGamepad as? GCDualSenseGamepad else { return }
        apply(pad.leftTrigger, type: typeLeft, params: left)
        apply(pad.rightTrigger, type: typeRight, params: right)
    }

    private func resetTriggers() {
        guard let pad = controller?.extendedGamepad as? GCDualSenseGamepad else { return }
        pad.leftTrigger.setModeOff()
        pad.rightTrigger.setModeOff()
    }

    private func unit(_ b: UInt8) -> Float { Float(b) / 255 }
    private func byte(_ p: [UInt8], _ i: Int) -> UInt8 { i < p.count ? p[i] : 0 }

    // The newer effects name ten trigger zones in a bit mask; Apple's API takes a span.
    private func zones(_ p: [UInt8]) -> (start: Float, end: Float)? {
        let mask = UInt16(byte(p, 0)) | (UInt16(byte(p, 1)) << 8)
        guard mask != 0 else { return nil }
        var first = -1
        var last = -1
        for i in 0..<10 where mask & (1 << i) != 0 {
            if first < 0 { first = i }
            last = i
        }
        return (Float(first) / 9, Float(last) / 9)
    }

    // Strongest of the 3-bit per-zone strengths packed from `from` on.
    private func strongest(_ p: [UInt8], from: Int) -> Float {
        var best: UInt32 = 0
        var bits: UInt32 = 0
        var acc: UInt32 = 0
        for i in from..<min(p.count, from + 4) {
            acc |= UInt32(p[i]) << bits
            bits += 8
            while bits >= 3 {
                best = max(best, acc & 0x7)
                acc >>= 3
                bits -= 3
            }
        }
        return Float(best) / 7
    }

    private func apply(_ trigger: GCDualSenseAdaptiveTrigger, type: UInt8, params p: [UInt8]) {
        switch type {
        case Effect.simpleFeedback:
            let strength = unit(byte(p, 1))
            guard strength > 0 else { return trigger.setModeOff() }
            trigger.setModeFeedbackWithStartPosition(unit(byte(p, 0)), resistiveStrength: strength)
        case Effect.simpleWeapon:
            let start = unit(byte(p, 0))
            let end = max(unit(byte(p, 1)), min(1, start + 0.1)) // Apple needs end after start
            let strength = unit(byte(p, 2))
            guard strength > 0 else { return trigger.setModeOff() }
            trigger.setModeWeaponWithStartPosition(start, endPosition: end, resistiveStrength: strength)
        case Effect.simpleVibration:
            let amplitude = unit(byte(p, 1))
            guard amplitude > 0 else { return trigger.setModeOff() }
            trigger.setModeVibrationWithStartPosition(unit(byte(p, 0)), amplitude: amplitude, frequency: max(0.05, unit(byte(p, 2))))
        case Effect.feedback:
            guard let span = zones(p) else { return trigger.setModeOff() }
            let strength = strongest(p, from: 2)
            guard strength > 0 else { return trigger.setModeOff() }
            trigger.setModeFeedbackWithStartPosition(span.start, resistiveStrength: strength)
        case Effect.weapon, Effect.bow:
            guard let span = zones(p) else { return trigger.setModeOff() }
            let end = max(span.end, min(1, span.start + 0.1))
            let strength = Float(byte(p, 2) & 0x7) / 7
            guard strength > 0 else { return trigger.setModeOff() }
            trigger.setModeWeaponWithStartPosition(span.start, endPosition: end, resistiveStrength: strength)
        case Effect.vibration, Effect.galloping, Effect.machine:
            guard let span = zones(p) else { return trigger.setModeOff() }
            let amplitude = strongest(p, from: 2)
            guard amplitude > 0 else { return trigger.setModeOff() }
            let frequency = byte(p, 8) != 0 ? byte(p, 8) : byte(p, 9)
            trigger.setModeVibrationWithStartPosition(span.start, amplitude: amplitude, frequency: max(0.08, unit(frequency)))
        default:
            trigger.setModeOff()
        }
    }

    // MARK: - Motion

    /// The controller's own gyroscope and accelerometer, while a PlayStation stream runs.
    func motion(_ on: Bool) {
        DispatchQueue.main.async {
            self.motionOn = on
            self.followController()
        }
    }

    private func followController() {
        if let old = motionController?.motion {
            old.valueChangedHandler = nil
            if old.sensorsRequireManualActivation { old.sensorsActive = false }
        }
        motionController = nil
        hc_core_motion_reset()
        guard motionOn, let current = controller, let motion = current.motion else { return }
        if motion.sensorsRequireManualActivation { motion.sensorsActive = true }
        motion.valueChangedHandler = { motion in
            // Apple's controller frame is Z-up; the console's is Y-up with Z toward the
            // player: console(x, y, z) = Apple(x, z, -y). Apple's acceleration points
            // along gravity, the console reports the reaction to it, hence the sign.
            let r = motion.rotationRate
            let a: GCAcceleration
            if motion.hasGravityAndUserAcceleration {
                a = GCAcceleration(x: motion.gravity.x + motion.userAcceleration.x,
                                   y: motion.gravity.y + motion.userAcceleration.y,
                                   z: motion.gravity.z + motion.userAcceleration.z)
            } else {
                a = motion.acceleration
            }
            let micros = UInt64(ProcessInfo.processInfo.systemUptime * 1_000_000)
            hc_core_motion(Float(r.x), Float(r.z), Float(-r.y), Float(-a.x), Float(-a.z), Float(a.y), micros)
        }
        motionController = current
    }
}
