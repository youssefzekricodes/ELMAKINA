package com.elmekina.game;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * The WebView's hand into the launcher: push the streak count to the widget, and ask the system
 * "pin this to the home screen?" sheet (API 26+) — the Duolingo prompt, done natively.
 */
@CapacitorPlugin(name = "StreakWidget")
public class StreakWidgetPlugin extends Plugin {

  @PluginMethod
  public void update(PluginCall call) {
    int count = call.getInt("count", 0);
    String label = call.getString("label", "");
    Context ctx = getContext();
    ctx.getSharedPreferences(StreakWidget.PREFS, Context.MODE_PRIVATE)
       .edit().putInt(StreakWidget.KEY_COUNT, count).putString(StreakWidget.KEY_LABEL, label).apply();
    StreakWidget.refreshAll(ctx);
    call.resolve();
  }

  @PluginMethod
  public void canPin(PluginCall call) {
    boolean ok = false;
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      AppWidgetManager m = AppWidgetManager.getInstance(getContext());
      ok = m != null && m.isRequestPinAppWidgetSupported();
    }
    JSObject out = new JSObject();
    out.put("value", ok);
    call.resolve(out);
  }

  /**
   * Is one already on the home screen?
   *
   * getAppWidgetIds returns an id per PLACED instance, so a non-empty array is the only honest
   * answer to "is it pinned" — Android offers nothing more direct. Lets the app stop offering a
   * button for something the player has already done.
   */
  @PluginMethod
  public void isPinned(PluginCall call) {
    AppWidgetManager m = AppWidgetManager.getInstance(getContext());
    int[] ids = m == null ? null : m.getAppWidgetIds(new ComponentName(getContext(), StreakWidget.class));
    JSObject out = new JSObject();
    out.put("value", ids != null && ids.length > 0);
    call.resolve(out);
  }

  @PluginMethod
  public void pin(PluginCall call) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      AppWidgetManager m = AppWidgetManager.getInstance(getContext());
      if (m != null && m.isRequestPinAppWidgetSupported()) {
        m.requestPinAppWidget(new ComponentName(getContext(), StreakWidget.class), null, null);
        call.resolve();
        return;
      }
    }
    call.reject("pinning not supported");
  }
}
