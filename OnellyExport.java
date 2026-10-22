package app.onelly.edit;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;

import androidx.media3.common.Effect;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MimeTypes;
import androidx.media3.common.audio.AudioProcessor;
import androidx.media3.common.audio.ChannelMixingAudioProcessor;
import androidx.media3.common.audio.ChannelMixingMatrix;
import androidx.media3.common.audio.SonicAudioProcessor;
import androidx.media3.effect.BitmapOverlay;
import androidx.media3.effect.Contrast;
import androidx.media3.effect.HslAdjustment;
import androidx.media3.effect.OverlayEffect;
import androidx.media3.effect.OverlaySettings;
import androidx.media3.effect.Presentation;
import androidx.media3.effect.RgbAdjustment;
import androidx.media3.effect.ScaleAndRotateTransformation;
import androidx.media3.effect.SpeedChangeEffect;
import androidx.media3.effect.TextureOverlay;
import androidx.media3.transformer.Composition;
import androidx.media3.transformer.DefaultEncoderFactory;
import androidx.media3.transformer.EditedMediaItem;
import androidx.media3.transformer.EditedMediaItemSequence;
import androidx.media3.transformer.Effects;
import androidx.media3.transformer.ExportException;
import androidx.media3.transformer.ExportResult;
import androidx.media3.transformer.ProgressHolder;
import androidx.media3.transformer.Transformer;
import androidx.media3.transformer.VideoEncoderSettings;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.common.collect.ImmutableList;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * Onelly fast export: hardware decode + hardware encode (Media3 Transformer).
 * It is NOT tied to playback speed, so it runs faster than real time.
 */
@CapacitorPlugin(name = "OnellyExport")
public class OnellyExport extends Plugin {

  private final Handler main = new Handler(Looper.getMainLooper());
  private Transformer transformer;
  private PluginCall pending;
  private volatile boolean running = false;

  private File dir() {
    File d = new File(getContext().getCacheDir(), "onelly");
    d.mkdirs();
    return d;
  }

  /* ---------- file transfer from the WebView (blob -> real file) ---------- */

  @PluginMethod
  public void writeChunk(PluginCall call) {
    try {
      String name = new File(call.getString("name", "x.bin")).getName();
      String data = call.getString("data", "");
      boolean first = Boolean.TRUE.equals(call.getBoolean("first", false));
      byte[] b = Base64.decode(data, Base64.DEFAULT);
      FileOutputStream o = new FileOutputStream(new File(dir(), name), !first);
      try {
        o.write(b);
      } finally {
        o.close();
      }
      call.resolve();
    } catch (Exception e) {
      call.reject(String.valueOf(e.getMessage()));
    }
  }

  @PluginMethod
  public void exists(PluginCall call) {
    String name = new File(call.getString("name", "x")).getName();
    JSObject o = new JSObject();
    o.put("exists", new File(dir(), name).exists());
    call.resolve(o);
  }

  /* ---------- overlay that is only visible between from..to (or fade-to-black) ---------- */

  private static final Bitmap BLANK = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888);

  private static class TimedOverlay extends BitmapOverlay {
    private final String path;
    private final long fromUs, toUs;
    private final boolean fade;
    private final double fi, fo, tot;
    private Bitmap cur;

    TimedOverlay(String path, double from, double to, boolean fade, double fi, double fo, double tot, Bitmap fixed) {
      this.path = path;
      this.fromUs = (long) (from * 1e6);
      this.toUs = (long) (to * 1e6);
      this.fade = fade;
      this.fi = fi;
      this.fo = fo;
      this.tot = tot;
      this.cur = fixed;
    }

    @Override
    public Bitmap getBitmap(long us) {
      if (fade) return cur;
      boolean near = us >= fromUs - 500000L && us <= toUs + 500000L;
      if (near) {
        if (cur == null) cur = BitmapFactory.decodeFile(path);
        return cur != null ? cur : BLANK;
      }
      cur = null; // free memory (many subtitles would not fit in RAM otherwise)
      return BLANK;
    }

    @Override
    public OverlaySettings getOverlaySettings(long us) {
      float a;
      if (fade) {
        double t = us / 1e6, f = 1;
        if (fi > 0 && t < fi) f = Math.min(f, Math.max(0, t / fi));
        if (fo > 0 && t > tot - fo) f = Math.min(f, Math.max(0, (tot - t) / fo));
        a = (float) (1 - f);
      } else {
        a = (us >= fromUs && us < toUs) ? 1f : 0f;
      }
      return new OverlaySettings.Builder().setAlphaScale(a).build();
    }
  }

  /* ---------- export ---------- */

  @PluginMethod
  public void startExport(final PluginCall call) {
    final String pj = call.getString("project");
    if (running) {
      call.reject("busy");
      return;
    }
    running = true;
    pending = call;
    getActivity().runOnUiThread(new Runnable() {
      @Override
      public void run() {
        try {
          begin(call, new JSONObject(pj));
        } catch (Throwable e) {
          running = false;
          call.reject(String.valueOf(e));
        }
      }
    });
  }

  private void begin(final PluginCall call, JSONObject p) throws Exception {
    final Context ctx = getContext();
    final int W = p.getInt("W"), H = p.getInt("H"), br = p.getInt("bitrate");
    final double total = p.getDouble("total");

    File[] old = dir().listFiles();
    if (old != null) for (File f : old) if (f.getName().startsWith("onelly-edit-")) f.delete();
    final File out = new File(dir(), "onelly-edit-" + System.currentTimeMillis() + ".mp4");

    List<EditedMediaItem> items = new ArrayList<EditedMediaItem>();
    JSONArray cl = p.getJSONArray("clips");
    for (int i = 0; i < cl.length(); i++) {
      JSONObject c = cl.getJSONObject(i);
      File f = new File(dir(), c.getString("file"));
      if (!f.exists()) throw new Exception("missing source " + c.getString("file"));
      double in = c.getDouble("in"), outT = c.getDouble("out");
      double speed = c.optDouble("speed", 1), vol = c.optDouble("vol", 1);

      MediaItem.ClippingConfiguration cc = new MediaItem.ClippingConfiguration.Builder()
          .setStartPositionMs((long) (in * 1000))
          .setEndPositionMs((long) (outT * 1000))
          .build();
      MediaItem mi = new MediaItem.Builder().setUri(Uri.fromFile(f)).setClippingConfiguration(cc).build();

      List<Effect> v = new ArrayList<Effect>();
      List<AudioProcessor> a = new ArrayList<AudioProcessor>();

      if (Math.abs(speed - 1) > 0.001) {
        v.add(new SpeedChangeEffect((float) speed));
        SonicAudioProcessor sonic = new SonicAudioProcessor();
        sonic.setSpeed((float) speed);
        sonic.setPitch(1f);
        a.add(sonic);
      }
      if (Math.abs(vol - 1) > 0.01 && vol > 0.001) {
        ChannelMixingAudioProcessor mixer = new ChannelMixingAudioProcessor();
        mixer.putChannelMixingMatrix(ChannelMixingMatrix.create(1, 1).scaleBy((float) vol));
        mixer.putChannelMixingMatrix(ChannelMixingMatrix.create(2, 2).scaleBy((float) vol));
        a.add(mixer);
      }

      double b = c.optDouble("b", 1), ct = c.optDouble("c", 1), s = c.optDouble("s", 1), hue = c.optDouble("hue", 0);
      if (Math.abs(b - 1) > 0.01) {
        v.add(new RgbAdjustment.Builder().setRedScale((float) b).setGreenScale((float) b).setBlueScale((float) b).build());
      }
      if (Math.abs(ct - 1) > 0.01) {
        v.add(new Contrast((float) Math.max(-1, Math.min(1, ct - 1))));
      }
      if (Math.abs(s - 1) > 0.01 || Math.abs(hue) > 0.5) {
        HslAdjustment.Builder h = new HslAdjustment.Builder();
        h.adjustSaturation((float) Math.max(-100, Math.min(100, (s - 1) * 100)));
        h.adjustHue((float) hue);
        v.add(h.build());
      }
      if (c.optInt("flip", 0) != 0) {
        v.add(new ScaleAndRotateTransformation.Builder().setScale(-1f, 1f).build());
      }
      int rot = ((c.optInt("rot", 0) % 360) + 360) % 360;
      if (rot != 0) {
        v.add(new ScaleAndRotateTransformation.Builder().setRotationDegrees(-rot).build());
      }
      v.add(Presentation.createForWidthAndHeight(W, H, Presentation.LAYOUT_SCALE_TO_FIT));
      double zm = c.optDouble("zm", 1);
      if (Math.abs(zm - 1) > 0.001) {
        v.add(new ScaleAndRotateTransformation.Builder().setScale((float) zm, (float) zm).build());
      }

      EditedMediaItem.Builder eb = new EditedMediaItem.Builder(mi).setEffects(new Effects(a, v));
      if (vol <= 0.001) eb.setRemoveAudio(true);
      items.add(eb.build());
    }
    if (items.isEmpty()) throw new Exception("no clips");

    /* overlays (text / emoji / images are pre-drawn by the editor as full-frame PNGs) + fade */
    List<TextureOverlay> ovs = new ArrayList<TextureOverlay>();
    JSONArray oa = p.optJSONArray("overlays");
    if (oa != null) {
      for (int i = 0; i < oa.length(); i++) {
        JSONObject o = oa.getJSONObject(i);
        File f = new File(dir(), o.getString("file"));
        if (!f.exists()) continue;
        ovs.add(new TimedOverlay(f.getAbsolutePath(), o.getDouble("from"), o.getDouble("to"), false, 0, 0, total, null));
      }
    }
    JSONObject fd = p.optJSONObject("fade");
    if (fd != null && (fd.optDouble("i", 0) > 0 || fd.optDouble("o", 0) > 0)) {
      Bitmap black = Bitmap.createBitmap(W, H, Bitmap.Config.ARGB_8888);
      black.eraseColor(Color.BLACK);
      ovs.add(new TimedOverlay(null, 0, total, true, fd.optDouble("i", 0), fd.optDouble("o", 0), total, black));
    }

    Composition.Builder cb = new Composition.Builder(new EditedMediaItemSequence(items));
    if (!ovs.isEmpty()) {
      List<Effect> ce = new ArrayList<Effect>();
      ce.add(new OverlayEffect(ImmutableList.copyOf(ovs)));
      cb.setEffects(new Effects(new ArrayList<AudioProcessor>(), ce));
    }
    Composition composition = cb.build();

    transformer = new Transformer.Builder(ctx)
        .setVideoMimeType(MimeTypes.VIDEO_H264)
        .setAudioMimeType(MimeTypes.AUDIO_AAC)
        .setEncoderFactory(new DefaultEncoderFactory.Builder(ctx)
            .setRequestedVideoEncoderSettings(new VideoEncoderSettings.Builder().setBitrate(br).build())
            .build())
        .addListener(new Transformer.Listener() {
          @Override
          public void onCompleted(Composition comp, ExportResult result) {
            running = false;
            JSObject o = new JSObject();
            o.put("path", out.getAbsolutePath());
            o.put("uri", "file://" + out.getAbsolutePath());
            o.put("size", out.length());
            call.resolve(o);
          }

          @Override
          public void onError(Composition comp, ExportResult result, ExportException e) {
            running = false;
            call.reject(String.valueOf(e));
          }
        })
        .build();

    transformer.start(composition, out.getAbsolutePath());

    final ProgressHolder ph = new ProgressHolder();
    main.postDelayed(new Runnable() {
      @Override
      public void run() {
        if (!running || transformer == null) return;
        if (transformer.getProgress(ph) != Transformer.PROGRESS_STATE_NOT_STARTED) {
          JSObject o = new JSObject();
          o.put("p", ph.progress / 100.0);
          notifyListeners("progress", o);
        }
        main.postDelayed(this, 300);
      }
    }, 300);
  }

  @PluginMethod
  public void cancel(final PluginCall call) {
    main.post(new Runnable() {
      @Override
      public void run() {
        try {
          if (transformer != null && running) transformer.cancel();
        } catch (Throwable ignored) {
        }
        running = false;
        if (pending != null) {
          try {
            pending.reject("cancelled");
          } catch (Throwable ignored) {
          }
          pending = null;
        }
        call.resolve();
      }
    });
  }
}
