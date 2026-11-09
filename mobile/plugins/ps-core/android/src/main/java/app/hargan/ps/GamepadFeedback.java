// SPDX-License-Identifier: AGPL-3.0-only
package app.hargan.ps;

import android.annotation.SuppressLint;
import android.content.Context;
import android.graphics.Color;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.hardware.input.InputManager;
import android.hardware.lights.Light;
import android.hardware.lights.LightState;
import android.hardware.lights.LightsManager;
import android.hardware.lights.LightsRequest;
import android.os.Build;
import android.os.CombinedVibration;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.os.VibratorManager;
import android.view.InputDevice;

/**
 * What a game asks of the controller, played on the one paired with the phone:
 * rumble on both motors, the light bar colour, and the controller's motion fed
 * back to the stream. Android gives apps rumble on every version, light and
 * motion on 12 and later; it has no way to drive adaptive triggers.
 */
final class GamepadFeedback implements PsCore.Feedback {

    // Rumble from a PlayStation game lasts until the next change.
    private static final int HOLD_MS = 10_000;
    private static final int MOTION_PERIOD_US = 16_666;

    private final Context context;
    private final HandlerThread thread = new HandlerThread("HarganGamepad");
    private final Handler handler;
    private Object lightSession;
    private SensorManager motionSensors;
    private final float[] accel = new float[3];
    private boolean accelFresh;

    GamepadFeedback(Context context) {
        this.context = context.getApplicationContext();
        thread.start();
        handler = new Handler(thread.getLooper());
    }

    /** The first controller the system lists, skipping the phone's own keys. */
    private static InputDevice gamepad() {
        for (int id : InputDevice.getDeviceIds()) {
            InputDevice device = InputDevice.getDevice(id);
            if (device == null || device.isVirtual()) continue;
            int sources = device.getSources();
            if ((sources & InputDevice.SOURCE_GAMEPAD) == InputDevice.SOURCE_GAMEPAD
                    || (sources & InputDevice.SOURCE_JOYSTICK) == InputDevice.SOURCE_JOYSTICK) return device;
        }
        return null;
    }

    @Override
    public void onFeedback(int kind, byte[] data) {
        handler.post(() -> {
            switch (kind) {
                case RUMBLE:
                    if (data.length >= 2) rumble(data[0] & 0xff, data[1] & 0xff, HOLD_MS);
                    break;
                case LIGHT:
                    if (data.length >= 3) light(data[0] & 0xff, data[1] & 0xff, data[2] & 0xff);
                    break;
                case RESET:
                    rumble(0, 0, 0);
                    closeLight();
                    break;
                default:
                    // TRIGGERS: Android has no API for adaptive triggers.
                    break;
            }
        });
    }

    /** left is the strong, low-frequency motor, right the light one; 0-255. */
    void rumbleFor(int left, int right, int durationMs) {
        handler.post(() -> rumble(left, right, durationMs));
    }

    private static VibrationEffect effect(int amplitude, int durationMs) {
        return VibrationEffect.createOneShot(Math.max(1, durationMs), Math.max(1, Math.min(255, amplitude)));
    }

    @SuppressLint("MissingPermission")
    private void rumble(int left, int right, int durationMs) {
        InputDevice device = gamepad();
        if (device == null) return;
        boolean off = (left == 0 && right == 0) || durationMs <= 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            VibratorManager manager = device.getVibratorManager();
            int[] ids = manager.getVibratorIds();
            if (off || ids.length == 0) {
                manager.cancel();
                if (ids.length > 0) return;
            } else {
                CombinedVibration.ParallelCombination both = CombinedVibration.startParallel();
                if (left > 0) both.addVibrator(ids[0], effect(left, durationMs));
                if (ids.length > 1 && right > 0) both.addVibrator(ids[1], effect(right, durationMs));
                else if (ids.length == 1 && left == 0) both.addVibrator(ids[0], effect(right, durationMs));
                manager.vibrate(both.combine());
                return;
            }
        }
        Vibrator vibrator = device.getVibrator();
        if (vibrator == null || !vibrator.hasVibrator()) return;
        if (off) vibrator.cancel();
        else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(effect(Math.max(left, right), durationMs));
        else vibrator.vibrate(durationMs);
    }

    private void light(int red, int green, int blue) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
        InputDevice device = gamepad();
        if (device == null) return;
        LightsManager lights = device.getLightsManager();
        for (Light light : lights.getLights()) {
            if (!light.hasRgbControl()) continue;
            if (lightSession == null) lightSession = lights.openSession();
            LightsRequest request = new LightsRequest.Builder()
                    .addLight(light, new LightState.Builder().setColor(Color.argb(255, red, green, blue)).build())
                    .build();
            ((LightsManager.LightsSession) lightSession).requestLights(request);
            return;
        }
    }

    private void closeLight() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && lightSession != null) {
            ((LightsManager.LightsSession) lightSession).close();
        }
        lightSession = null;
    }

    // --- motion -----------------------------------------------------------------

    private final SensorEventListener motionListener = new SensorEventListener() {
        @Override
        public void onSensorChanged(SensorEvent event) {
            if (event.sensor.getType() == Sensor.TYPE_ACCELEROMETER) {
                // The controller's driver already reports in the console's axes; the
                // console wants g, Android gives m/s².
                accel[0] = event.values[0] / SensorManager.GRAVITY_EARTH;
                accel[1] = event.values[1] / SensorManager.GRAVITY_EARTH;
                accel[2] = event.values[2] / SensorManager.GRAVITY_EARTH;
                accelFresh = true;
            } else if (event.sensor.getType() == Sensor.TYPE_GYROSCOPE && accelFresh) {
                PsCore.motion(event.values[0], event.values[1], event.values[2], accel[0], accel[1], accel[2], event.timestamp / 1000);
            }
        }

        @Override
        public void onAccuracyChanged(Sensor sensor, int accuracy) {}
    };

    /** The controller's own gyroscope and accelerometer, while a PlayStation stream runs. */
    void motion(boolean on) {
        handler.post(() -> {
            stopMotion();
            if (!on || Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return;
            InputDevice device = gamepad();
            if (device == null) return;
            SensorManager sensors = device.getSensorManager();
            Sensor gyro = sensors.getDefaultSensor(Sensor.TYPE_GYROSCOPE);
            Sensor accelerometer = sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER);
            if (gyro == null || accelerometer == null) return;
            accelFresh = false;
            sensors.registerListener(motionListener, accelerometer, MOTION_PERIOD_US, 0, handler);
            sensors.registerListener(motionListener, gyro, MOTION_PERIOD_US, 0, handler);
            motionSensors = sensors;
        });
    }

    private void stopMotion() {
        if (motionSensors == null) return;
        motionSensors.unregisterListener(motionListener);
        motionSensors = null;
        if (PsCore.load()) PsCore.motionReset();
    }

    // A controller plugged in or out mid-stream: follow it.
    private final InputManager.InputDeviceListener devices = new InputManager.InputDeviceListener() {
        @Override
        public void onInputDeviceAdded(int deviceId) {
            if (motionSensors != null) motion(true);
        }

        @Override
        public void onInputDeviceRemoved(int deviceId) {
            if (motionSensors != null) motion(true);
        }

        @Override
        public void onInputDeviceChanged(int deviceId) {}
    };

    void watchDevices() {
        InputManager input = (InputManager) context.getSystemService(Context.INPUT_SERVICE);
        if (input != null) input.registerInputDeviceListener(devices, handler);
    }

    void close() {
        handler.post(() -> {
            stopMotion();
            rumble(0, 0, 0);
            closeLight();
            InputManager input = (InputManager) context.getSystemService(Context.INPUT_SERVICE);
            if (input != null) input.unregisterInputDeviceListener(devices);
            thread.quitSafely();
        });
    }
}
