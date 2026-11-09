// SPDX-License-Identifier: AGPL-3.0-only
package app.hargan.ps;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.util.Base64;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.cert.Certificate;
import java.util.Enumeration;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * window.hc.ps on Android: starts the native core, passes its JSON messages both
 * ways, signs in to Sony in a web view, and keeps the device awake while streaming.
 */
@CapacitorPlugin(name = "PsCore")
public class PsCorePlugin extends Plugin {

    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private WifiManager.WifiLock wifiLock;
    private PsSignIn activeSignIn;

    @Override
    public void load() {
        PsCore.listener = (line) -> {
            JSObject data = new JSObject();
            data.put("line", line);
            notifyListeners("line", data);
        };
    }

    @PluginMethod
    public void start(PluginCall call) {
        worker.execute(() -> {
            if (!PsCore.load()) {
                call.reject("PlayStation bu cihazda desteklenmiyor.");
                return;
            }
            String started = PsCore.start(getContext().getCacheDir().getAbsolutePath(), writeCaBundle());
            if (started == null) {
                call.reject("PlayStation çekirdeği başlatılamadı.");
                return;
            }
            String[] parts = started.split(" ");
            JSObject result = new JSObject();
            result.put("port", Integer.parseInt(parts[0]));
            result.put("token", parts[1]);
            call.resolve(result);
        });
    }

    @PluginMethod
    public void command(PluginCall call) {
        String line = call.getString("line");
        if (line == null) {
            call.reject("Komut boş");
            return;
        }
        worker.execute(() -> {
            PsCore.command(line);
            call.resolve();
        });
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        String url = call.getString("url");
        String redirect = call.getString("redirect");
        String session = call.getString("session");
        if (url == null || redirect == null || session == null) {
            call.reject("Giriş adresi eksik");
            return;
        }
        getActivity().runOnUiThread(() -> {
            if (activeSignIn != null) activeSignIn.dismiss();
            activeSignIn = new PsSignIn(getActivity(), url, redirect, session, (npsso) -> {
                activeSignIn = null;
                if (npsso == null) {
                    call.reject("Giriş kapatıldı", "CANCELLED");
                    return;
                }
                JSObject result = new JSObject();
                result.put("npsso", npsso);
                call.resolve(result);
            });
            activeSignIn.show();
        });
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        PsSignIn.forgetSession(() -> {
            deleteTree(new File(getContext().getCacheDir(), "ps-catalog"));
            call.resolve();
        });
    }

    /** A stream is watched, not touched: keep the screen on and Wi-Fi out of power saving. */
    @PluginMethod
    public void streaming(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            setWifiLock(on);
            call.resolve();
        });
    }

    @Override
    protected void handleOnDestroy() {
        setWifiLock(false);
        PsCore.listener = null;
    }

    private void setWifiLock(boolean on) {
        if (on && wifiLock == null) {
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            if (wifi == null) return;
            int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wifi.createWifiLock(mode, "HarganCast:stream");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        } else if (!on && wifiLock != null) {
            wifiLock.release();
            wifiLock = null;
        }
    }

    /**
     * curl runs on mbedTLS here, which cannot read Android's certificate store, so the
     * system's trusted roots are written out as one PEM file. Certificates the owner
     * added by hand are left out, as Android itself does for apps.
     */
    private String writeCaBundle() {
        File file = new File(getContext().getCacheDir(), "ca-bundle.pem");
        try {
            KeyStore store = KeyStore.getInstance("AndroidCAStore");
            store.load(null, null);
            StringBuilder pem = new StringBuilder();
            Enumeration<String> aliases = store.aliases();
            while (aliases.hasMoreElements()) {
                String alias = aliases.nextElement();
                if (!alias.startsWith("system:")) continue;
                Certificate cert = store.getCertificate(alias);
                if (cert == null) continue;
                pem.append("-----BEGIN CERTIFICATE-----\n");
                pem.append(Base64.encodeToString(cert.getEncoded(), Base64.DEFAULT));
                pem.append("-----END CERTIFICATE-----\n");
            }
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(pem.toString().getBytes(StandardCharsets.US_ASCII));
            }
            return file.getAbsolutePath();
        } catch (Exception e) {
            return null;
        }
    }

    private static void deleteTree(File file) {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) deleteTree(child);
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }
}
