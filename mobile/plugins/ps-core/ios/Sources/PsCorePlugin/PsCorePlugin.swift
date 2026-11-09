// SPDX-License-Identifier: AGPL-3.0-only
import Capacitor
import Foundation
import HarganPsCoreC
import UIKit

/// window.hc.ps on iOS: starts the native core, passes its JSON messages both ways,
/// signs in to Sony in a web view, and keeps the screen on while streaming.
@objc(PsCorePlugin)
public class PsCorePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PsCorePlugin"
    public let jsName = "PsCore"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "command", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signIn", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "signOut", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "streaming", returnType: CAPPluginReturnPromise)
    ]

    private let queue = DispatchQueue(label: "app.hargan.ps")
    private var activeSignIn: PsSignInController?

    private static var cacheDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
    }

    fileprivate func deliver(_ line: String) {
        DispatchQueue.main.async { [weak self] in
            self?.notifyListeners("line", data: ["line": line])
        }
    }

    @objc func start(_ call: CAPPluginCall) {
        queue.async {
            var port: Int32 = 0
            let capacity = 64
            var token = [CChar](repeating: 0, count: capacity)
            let user = Unmanaged.passUnretained(self).toOpaque()
            // The OS verifies TLS here, so there is no certificate bundle to hand over.
            let ok = hc_core_start(emitLine, user, PsCorePlugin.cacheDirectory.path, nil, &port, &token, capacity)
            if ok {
                call.resolve(["port": Int(port), "token": String(cString: token)])
            } else {
                call.reject("PlayStation çekirdeği başlatılamadı.")
            }
        }
    }

    @objc func command(_ call: CAPPluginCall) {
        guard let line = call.getString("line") else {
            call.reject("Komut boş")
            return
        }
        queue.async {
            hc_core_command(line)
            call.resolve()
        }
    }

    @objc func signIn(_ call: CAPPluginCall) {
        guard let url = call.getString("url").flatMap({ URL(string: $0) }),
              let redirect = call.getString("redirect"),
              let session = call.getString("session").flatMap({ URL(string: $0) }) else {
            call.reject("Giriş adresi eksik")
            return
        }
        DispatchQueue.main.async {
            self.activeSignIn?.dismiss(animated: false)
            let controller = PsSignInController(url: url, redirect: redirect, session: session) { [weak self] npsso in
                self?.activeSignIn = nil
                if let npsso {
                    call.resolve(["npsso": npsso])
                } else {
                    call.reject("Giriş kapatıldı", "CANCELLED")
                }
            }
            self.activeSignIn = controller
            controller.present(from: self.bridge?.viewController)
        }
    }

    @objc func signOut(_ call: CAPPluginCall) {
        PsSignInController.forgetSession {
            try? FileManager.default.removeItem(at: PsCorePlugin.cacheDirectory.appendingPathComponent("ps-catalog"))
            call.resolve()
        }
    }

    /// A stream is watched, not touched: keep the screen from going to sleep.
    @objc func streaming(_ call: CAPPluginCall) {
        let on = call.getBool("on") ?? false
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = on
            call.resolve()
        }
    }
}

/// Called by the core from its own threads with one complete JSON message.
private func emitLine(_ line: UnsafePointer<CChar>?, _ size: Int, _ user: UnsafeMutableRawPointer?) {
    guard let line, let user else { return }
    let plugin = Unmanaged<PsCorePlugin>.fromOpaque(user).takeUnretainedValue()
    let bytes = UnsafeRawBufferPointer(start: UnsafeRawPointer(line), count: size)
    plugin.deliver(String(decoding: bytes, as: UTF8.self))
}
