// SPDX-License-Identifier: AGPL-3.0-only
import UIKit
import WebKit

/// Sony's sign-in page in a web view of the app's own, the same page the desktop
/// opens. Once Sony is done, its session token (NPSSO) is read from the cookie or
/// from Sony's session endpoint, which only answers to whoever holds that cookie.
final class PsSignInController: UIViewController, WKNavigationDelegate, UIAdaptivePresentationControllerDelegate {
    private let url: URL
    private let redirect: String
    private let session: URL
    private var completion: ((String?) -> Void)?
    private var web: WKWebView!

    init(url: URL, redirect: String, session: URL, completion: @escaping (String?) -> Void) {
        self.url = url
        self.redirect = redirect
        self.session = session
        self.completion = completion
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) {
        fatalError("not used from storyboards")
    }

    func present(from host: UIViewController?) {
        let navigation = UINavigationController(rootViewController: self)
        navigation.presentationController?.delegate = self
        host?.present(navigation, animated: true)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        title = "PlayStation hesabı"
        view.backgroundColor = .systemBackground
        navigationItem.rightBarButtonItem = UIBarButtonItem(title: "Kapat", style: .plain, target: self, action: #selector(close))

        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        web = WKWebView(frame: view.bounds, configuration: config)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        // Present as Safari; some sign-in pages turn embedded views away.
        web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
        view.addSubview(web)

        // A session left from an earlier sign-in may be expired; start clean.
        PsSignInController.forgetSession { [weak self] in
            guard let self else { return }
            self.web.load(URLRequest(url: self.url))
        }
    }

    /// Sign-out: drops Sony's site data so the next sign-in asks for the account again.
    static func forgetSession(_ done: @escaping () -> Void) {
        let store = WKWebsiteDataStore.default()
        let types = WKWebsiteDataStore.allWebsiteDataTypes()
        store.fetchDataRecords(ofTypes: types) { records in
            let sony = records.filter { $0.displayName.contains("sony") || $0.displayName.contains("playstation") }
            store.removeData(ofTypes: types, for: sony) {
                DispatchQueue.main.async(execute: done)
            }
        }
    }

    @objc private func close() {
        dismiss(animated: true)
        finish(nil)
    }

    func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
        finish(nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let next = navigationAction.request.url?.absoluteString, next.hasPrefix(redirect) {
            decisionHandler(.cancel)
            webView.load(URLRequest(url: session))
            return
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let page = webView.url?.absoluteString else { return }
        if page.hasPrefix(session.absoluteString) {
            readSession()
        } else {
            readCookie()
        }
    }

    // The endpoint's body is {"npsso": "..."}; the cookie is the fallback.
    private func readSession() {
        web.evaluateJavaScript("document.body ? document.body.innerText : ''") { [weak self] value, _ in
            if let text = value as? String,
               let data = text.data(using: .utf8),
               let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let npsso = json["npsso"] as? String,
               PsSignInController.looksLikeToken(npsso) {
                self?.finishAndClose(npsso)
                return
            }
            self?.readCookie()
        }
    }

    private func readCookie() {
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            let token = cookies.first { $0.name == "npsso" && $0.domain.hasSuffix("sony.com") }?.value
            if let token, PsSignInController.looksLikeToken(token) {
                self?.finishAndClose(token)
            }
        }
    }

    private static func looksLikeToken(_ value: String) -> Bool {
        (40...128).contains(value.count) && value.allSatisfy { $0.isASCII && ($0.isLetter || $0.isNumber) }
    }

    private func finishAndClose(_ npsso: String) {
        guard completion != nil else { return }
        dismiss(animated: true)
        finish(npsso)
    }

    private func finish(_ npsso: String?) {
        let done = completion
        completion = nil
        done?(npsso)
    }
}
