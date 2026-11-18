// SPDX-License-Identifier: AGPL-3.0-only
package app.hargan.ps;

import android.app.Activity;
import android.graphics.Color;
import android.media.MediaCodec;
import android.media.MediaCodecInfo;
import android.media.MediaFormat;
import android.os.Build;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.Surface;
import android.view.SurfaceHolder;
import android.view.SurfaceView;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.FrameLayout;
import java.nio.ByteBuffer;

/**
 * The stream's picture decoded by the phone's own MediaCodec straight onto a
 * SurfaceView under the (then transparent) web view. The frame never passes
 * through the web view's compositor, which saves its copy and its frame of delay.
 * The core hands over Annex B access units (PsCore.onVideo); audio and input stay
 * on the media socket.
 */
final class NativeVideo implements SurfaceHolder.Callback {

    interface Stats {
        void onStats(int fps, double decodeMs, long bytes, int width, int height, boolean firstFrame);
    }

    private static final long INPUT_WAIT_US = 10_000;

    private final Activity activity;
    private final WebView webView;
    private final String mime;
    private final int width;
    private final int height;
    private final Stats stats;
    private SurfaceView view;
    private MediaCodec codec;
    private Thread drain;
    private volatile boolean running;
    private boolean waitingForKey = true;
    private int frames;
    private volatile long bytes;
    private double decodeSum;
    private boolean shownFirst;
    private long statsAt;

    NativeVideo(Activity activity, WebView webView, boolean hevc, int width, int height, Stats stats) {
        this.activity = activity;
        this.webView = webView;
        this.mime = hevc ? MediaFormat.MIMETYPE_VIDEO_HEVC : MediaFormat.MIMETYPE_VIDEO_AVC;
        this.width = width;
        this.height = height;
        this.stats = stats;
    }

    private FrameLayout holder;

    /**
     * Puts the surface under the web view; decoding starts once it exists. It sits
     * in a frame of its own, since the web view's parent need not be a FrameLayout.
     */
    void show() {
        activity.runOnUiThread(() -> {
            ViewGroup parent = (ViewGroup) webView.getParent();
            holder = new FrameLayout(activity);
            holder.setBackgroundColor(Color.BLACK);
            view = new SurfaceView(activity);
            view.getHolder().addCallback(this);
            holder.addView(view, fitted(parent));
            parent.addView(holder, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
            webView.setBackgroundColor(Color.TRANSPARENT);
        });
    }

    // The picture keeps its shape, centred, like the app's own "keep aspect ratio".
    private FrameLayout.LayoutParams fitted(ViewGroup parent) {
        int w = parent.getWidth();
        int h = parent.getHeight();
        if (w == 0 || h == 0) return new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT, Gravity.CENTER);
        double scale = Math.min((double) w / width, (double) h / height);
        return new FrameLayout.LayoutParams((int) Math.round(width * scale), (int) Math.round(height * scale), Gravity.CENTER);
    }

    void hide() {
        stop();
        activity.runOnUiThread(() -> {
            if (holder != null) {
                ((ViewGroup) holder.getParent()).removeView(holder);
                holder = null;
                view = null;
            }
            webView.setBackgroundColor(Color.BLACK);
        });
    }

    @Override
    public void surfaceCreated(SurfaceHolder holder) {
        start(holder.getSurface());
    }

    @Override
    public void surfaceChanged(SurfaceHolder holder, int format, int w, int h) {}

    @Override
    public void surfaceDestroyed(SurfaceHolder holder) {
        stop();
    }

    private synchronized void start(Surface surface) {
        try {
            codec = MediaCodec.createDecoderByType(mime);
            MediaFormat format = MediaFormat.createVideoFormat(mime, width, height);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) format.setInteger(MediaFormat.KEY_LOW_LATENCY, 1);
            // Realtime priority: decode each frame as soon as it arrives.
            format.setInteger(MediaFormat.KEY_PRIORITY, 0);
            codec.configure(format, surface, null, 0);
            codec.start();
        } catch (Exception e) {
            codec = null;
            return;
        }
        running = true;
        waitingForKey = true;
        PsCore.requestKeyFrame();
        drain = new Thread(this::drainLoop, "HarganCast-video");
        drain.setPriority(Thread.MAX_PRIORITY);
        drain.start();
    }

    /** One access unit from the core's session thread. */
    synchronized void feed(byte[] data, boolean key) {
        if (!running || codec == null) return;
        bytes += data.length;
        if (waitingForKey) {
            if (!key) return;
            waitingForKey = false;
        }
        try {
            int index = codec.dequeueInputBuffer(INPUT_WAIT_US);
            if (index < 0) {
                // The decoder is behind: skip to the next key frame rather than fall further back.
                waitingForKey = true;
                PsCore.requestKeyFrame();
                return;
            }
            ByteBuffer input = codec.getInputBuffer(index);
            if (input == null) return;
            input.clear();
            input.put(data);
            // Arrival time as the timestamp: the drain loop measures decode time from it.
            codec.queueInputBuffer(index, 0, data.length, SystemClock.elapsedRealtimeNanos() / 1000, 0);
        } catch (Exception e) {
            waitingForKey = true;
            PsCore.requestKeyFrame();
        }
    }

    private void drainLoop() {
        MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
        statsAt = SystemClock.elapsedRealtime();
        while (running) {
            MediaCodec current = codec;
            if (current == null) break;
            int index;
            try {
                index = current.dequeueOutputBuffer(info, INPUT_WAIT_US);
            } catch (Exception e) {
                break;
            }
            if (index >= 0) {
                decodeSum += (SystemClock.elapsedRealtimeNanos() / 1000 - info.presentationTimeUs) / 1000.0;
                frames++;
                // Shown at once: a game stream wants the newest frame, not an even cadence.
                try {
                    current.releaseOutputBuffer(index, true);
                } catch (Exception e) {
                    break;
                }
                if (!shownFirst) {
                    shownFirst = true;
                    stats.onStats(0, 0, 0, width, height, true);
                }
            }
            long now = SystemClock.elapsedRealtime();
            if (now - statsAt >= 1000) {
                stats.onStats(frames, frames > 0 ? decodeSum / frames : 0, bytes, width, height, false);
                bytes = 0;
                frames = 0;
                decodeSum = 0;
                statsAt = now;
            }
        }
    }

    synchronized void stop() {
        running = false;
        if (drain != null) {
            try {
                drain.join(500);
            } catch (InterruptedException ignored) {
            }
            drain = null;
        }
        if (codec != null) {
            try {
                codec.stop();
            } catch (Exception ignored) {
            }
            codec.release();
            codec = null;
        }
    }

    /**
     * Decodes a short clip without a screen, to learn whether this phone's decoder
     * takes the stream's format: frames decoded, the decoder's name, and whether it
     * runs on hardware.
     */
    static String selfTest(byte[][] units, boolean hevc, int width, int height) {
        String mime = hevc ? MediaFormat.MIMETYPE_VIDEO_HEVC : MediaFormat.MIMETYPE_VIDEO_AVC;
        MediaCodec codec = null;
        int decoded = 0;
        String name = "";
        boolean hardware = false;
        try {
            codec = MediaCodec.createDecoderByType(mime);
            name = codec.getName();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                MediaCodecInfo info = codec.getCodecInfo();
                hardware = info.isHardwareAccelerated();
            }
            codec.configure(MediaFormat.createVideoFormat(mime, width, height), null, null, 0);
            codec.start();
            MediaCodec.BufferInfo out = new MediaCodec.BufferInfo();
            int sent = 0;
            long deadline = SystemClock.elapsedRealtime() + 5000;
            while (decoded < units.length && SystemClock.elapsedRealtime() < deadline) {
                if (sent < units.length) {
                    int in = codec.dequeueInputBuffer(INPUT_WAIT_US);
                    if (in >= 0) {
                        ByteBuffer buffer = codec.getInputBuffer(in);
                        buffer.clear();
                        buffer.put(units[sent]);
                        boolean last = sent == units.length - 1;
                        codec.queueInputBuffer(in, 0, units[sent].length, sent * 33_333L, last ? MediaCodec.BUFFER_FLAG_END_OF_STREAM : 0);
                        sent++;
                    }
                }
                int index = codec.dequeueOutputBuffer(out, INPUT_WAIT_US);
                if (index >= 0) {
                    if (out.size > 0 || (out.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) == 0) decoded++;
                    codec.releaseOutputBuffer(index, false);
                    if ((out.flags & MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) break;
                }
            }
        } catch (Exception e) {
            return "{\"decoded\":" + decoded + ",\"decoder\":\"" + name + "\",\"error\":\"" + e.getClass().getSimpleName() + "\"}";
        } finally {
            if (codec != null) {
                try {
                    codec.stop();
                } catch (Exception ignored) {
                }
                codec.release();
            }
        }
        return "{\"decoded\":" + decoded + ",\"decoder\":\"" + name + "\",\"hardware\":" + hardware + "}";
    }

}
