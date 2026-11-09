// SPDX-License-Identifier: AGPL-3.0-only
package app.hargan.ps;

import androidx.annotation.Keep;
import java.nio.charset.StandardCharsets;

/** The native core (native/ps-core/mobile): JSON commands in, JSON replies and events out. */
@Keep
final class PsCore {

    interface Listener {
        void onLine(String line);
    }

    /** Kinds match HC_FEEDBACK_* in hargan_ps.h. */
    interface Feedback {
        int RESET = 0;
        int RUMBLE = 1;
        int TRIGGERS = 2;
        int LIGHT = 3;

        void onFeedback(int kind, byte[] data);
    }

    private static Boolean loaded;
    static volatile Listener listener;
    static volatile Feedback feedback;

    private PsCore() {}

    /** False on devices the library was not built for; the rest of the app still runs. */
    static synchronized boolean load() {
        if (loaded == null) {
            try {
                System.loadLibrary("hargan_ps");
                loaded = true;
            } catch (UnsatisfiedLinkError e) {
                loaded = false;
            }
        }
        return loaded;
    }

    /** Returns "port token" for the media socket, or null. */
    static native String start(String cacheDir, String caBundle);

    private static native void command(byte[] line);

    static void command(String line) {
        command(line.getBytes(StandardCharsets.UTF_8));
    }

    /** One motion sample in the console's axes: rad/s and g. */
    static native void motion(float gyroX, float gyroY, float gyroZ, float accelX, float accelY, float accelZ, long timestampUs);

    static native void motionReset();

    /** Called by the core from its own threads. */
    @Keep
    static void onLine(byte[] line) {
        Listener current = listener;
        if (current != null) current.onLine(new String(line, StandardCharsets.UTF_8));
    }

    /** Called by the core from the session's threads. */
    @Keep
    static void onFeedback(int kind, byte[] data) {
        Feedback current = feedback;
        if (current != null) current.onFeedback(kind, data);
    }
}
