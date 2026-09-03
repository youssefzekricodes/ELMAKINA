package com.elmekina.game;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * The home-screen streak widget: the flame and the number, in the app's own dark wood.
 *
 * A launcher can only draw RemoteViews, so nothing from the WebView reaches here — the count is
 * read from SharedPreferences, which StreakWidgetPlugin writes every time the streak changes while
 * the app is open. updatePeriodMillis is 0 on purpose: the number can only move by playing, and
 * playing opens the app, which pushes. No alarms, no battery cost.
 */
public class StreakWidget extends AppWidgetProvider {
  static final String PREFS = "mekina_streak";
  static final String KEY_COUNT = "count";
  // The nudge under the number. Written by the app, which is the only side that knows whether the
  // player picked Derja or English — a widget cannot read the app's language setting for itself.
  static final String KEY_LABEL = "label";

  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
    for (int id : ids) manager.updateAppWidget(id, build(context));
  }

  static RemoteViews build(Context context) {
    android.content.SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    int count = prefs.getInt(KEY_COUNT, 0);
    // Empty means the app has never pushed one — a brand new install, before any game. Fall back to
    // the device locale so the widget never sits there with a number and no words under it.
    String label = prefs.getString(KEY_LABEL, "");
    if (label == null || label.isEmpty()) label = context.getString(R.string.widget_default);
    RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_streak);
    views.setTextViewText(R.id.widget_count, String.valueOf(count));
    views.setTextViewText(R.id.widget_label, label);
    // A cold streak says so at a glance: the number drains to the muted paper colour and the flame
    // dims. Nothing else changes, so the widget never looks broken — just unlit.
    boolean lit = count > 0;
    // The cold colour has to survive the SCENE behind it, not a flat gradient — the old muted brown
    // vanished into the artwork. Warm paper reads as "not lit" against the amber without becoming
    // unreadable, and the flame keeps enough alpha to still look like a flame.
    views.setTextColor(R.id.widget_count, lit ? 0xFFFFC24A : 0xFFD9CAB2);
    views.setInt(R.id.widget_fire, "setImageAlpha", lit ? 255 : 130);
    Intent open = new Intent(context, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    // the root now carries @android:id/background, which the launcher needs to clip our corners
    views.setOnClickPendingIntent(android.R.id.background,
        PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    return views;
  }

  /** Called by the plugin after every change: repaint every instance the launcher holds. */
  static void refreshAll(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, StreakWidget.class));
    for (int id : ids) manager.updateAppWidget(id, build(context));
  }
}
