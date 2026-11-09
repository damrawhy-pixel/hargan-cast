// SPDX-License-Identifier: AGPL-3.0-only
package app.hargan.ps;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.graphics.Typeface;
import android.view.Gravity;
import android.view.KeyEvent;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Sony's sign-in page in a web view of the app's own, the same page the desktop
 * opens. Once Sony is done, its session token (NPSSO) is read from the cookie or
 * from Sony's session endpoint, which only answers to whoever holds that cookie.
 */
final class PsSignIn {

    interface Result {
        void done(String npsso);
    }

    private static final String SONY = "https://ca.account.sony.com";
    private static final Pattern COOKIE = Pattern.compile("(?:^|;\\s*)npsso=([A-Za-z0-9]{40,128})");

    private final Dialog dialog;
    private final WebView web;
    private final String redirect;
    private final String session;
    private Result result;

    @SuppressLint("SetJavaScriptEnabled")
    PsSignIn(Activity activity, String url, String redirect, String session, Result result) {
        this.redirect = redirect;
        this.session = session;
        this.result = result;

        dialog = new Dialog(activity, android.R.style.Theme_DeviceDefault_Light_NoActionBar);
        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        root.setFitsSystemWindows(true);

        LinearLayout bar = new LinearLayout(activity);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        int pad = Math.round(12 * activity.getResources().getDisplayMetrics().density);
        bar.setPadding(pad * 2, pad, pad, pad);
        TextView title = new TextView(activity);
        title.setText("PlayStation hesabı");
        title.setTextSize(18);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        title.setTextColor(Color.BLACK);
        bar.addView(title, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1));
        Button close = new Button(activity, null, android.R.attr.borderlessButtonStyle);
        close.setText("Kapat");
        close.setOnClickListener((v) -> dialog.dismiss());
        bar.addView(close);
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        web = new WebView(activity);
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        // Present as the phone's own browser; some sign-in pages turn embedded views away.
        settings.setUserAgentString(settings.getUserAgentString().replace("; wv", "").replaceAll("Version/\\d+\\.\\d+ ", ""));
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(web, true);
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String next = request.getUrl().toString();
                if (next.startsWith(PsSignIn.this.redirect)) {
                    view.loadUrl(PsSignIn.this.session);
                    return true;
                }
                return false;
            }

            @Override
            public void onPageFinished(WebView view, String page) {
                if (page == null) return;
                if (page.startsWith(PsSignIn.this.session)) readSession();
                else if (page.startsWith(PsSignIn.this.redirect)) view.loadUrl(PsSignIn.this.session);
                else readCookie();
            }
        });
        root.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));

        dialog.setContentView(root);
        dialog.setOnKeyListener((d, keyCode, event) -> {
            if (keyCode == KeyEvent.KEYCODE_BACK && event.getAction() == KeyEvent.ACTION_UP && web.canGoBack()) {
                web.goBack();
                return true;
            }
            return false;
        });
        dialog.setOnDismissListener((d) -> {
            web.stopLoading();
            web.destroy();
            finish(null);
        });

        // A session left from an earlier sign-in may be expired; start clean.
        cookies.removeAllCookies((removed) -> web.loadUrl(url));
    }

    void show() {
        dialog.show();
    }

    void dismiss() {
        dialog.dismiss();
    }

    /** Sign-out: drops Sony's cookies so the next sign-in asks for the account again. */
    static void forgetSession(Runnable done) {
        CookieManager cookies = CookieManager.getInstance();
        cookies.removeAllCookies((removed) -> {
            cookies.flush();
            done.run();
        });
    }

    private void readCookie() {
        String jar = CookieManager.getInstance().getCookie(SONY);
        if (jar == null) return;
        Matcher match = COOKIE.matcher(jar);
        if (match.find()) finish(match.group(1));
    }

    // The endpoint's body is {"npsso": "..."}; the cookie is the fallback.
    private void readSession() {
        web.evaluateJavascript("document.body ? document.body.innerText : ''", (value) -> {
            try {
                String text = new JSONArray("[" + value + "]").getString(0);
                String npsso = new JSONObject(text).optString("npsso", "");
                if (npsso.matches("[A-Za-z0-9]{40,128}")) {
                    finish(npsso);
                    return;
                }
            } catch (Exception ignored) {
                // Not JSON: fall through to the cookie.
            }
            readCookie();
        });
    }

    private void finish(String npsso) {
        Result current = result;
        if (current == null) return;
        result = null;
        if (npsso != null) {
            CookieManager.getInstance().flush();
            dialog.dismiss();
        }
        current.done(npsso);
    }
}
