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

  /**
   * Everything the widget draws, in one push: the count, both nudge lines, the played and frozen
   * days as comma-joined ISO dates, and which banner (warm / freeze). Nothing is interpreted
   * here — StreakWidget.build reads the calendar and decides.
   */
  @PluginMethod
  public void update(PluginCall call) {
    Context ctx = getContext();
    ctx.getSharedPreferences(StreakWidget.PREFS, Context.MODE_PRIVATE).edit()
       .putInt(StreakWidget.KEY_COUNT, call.getInt("count", 0))
       .putString(StreakWidget.KEY_LABEL, call.getString("label", ""))
       .putString(StreakWidget.KEY_LABEL_COLD, call.getString("labelCold", ""))
       .putString(StreakWidget.KEY_PLAYED, call.getString("played", ""))
       .putString(StreakWidget.KEY_FROZEN, call.getString("frozen", ""))
       .putString(StreakWidget.KEY_MOOD, call.getString("mood", "warm"))
       .apply();
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
