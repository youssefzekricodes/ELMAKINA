package com.elmekina.game;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.util.SizeF;
import android.widget.RemoteViews;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The home-screen streak widget: the flame and the number over the app's own streak banner —
 * the warm one while the streak lives, the frozen one when it is on ice or one ad from dying.
 *
 * A launcher can only draw RemoteViews, so nothing from the WebView reaches here — everything is
 * read from SharedPreferences, which StreakWidgetPlugin writes every time the streak changes while
 * the app is open. The app also pushes the DAYS played, so the widget can tell for itself whether
 * "today" has been played: that is what lets the nudge under the number flip from "Lit today" to
 * "Come play" the next morning without the app being opened.
 *
 * updatePeriodMillis is 0 on purpose: the count can only move by playing, and playing opens the
 * app, which pushes. The single thing that changes on its own is the date, and for that build()
 * arms one inexact alarm at the next local midnight — no polling, no battery cost.
 */
public class StreakWidget extends AppWidgetProvider {
  static final String PREFS = "mekina_streak";
  static final String KEY_COUNT = "count";
  // The nudge under the number, in the app's language (only the app knows which one that is).
  // Two of them: the line for "played today", and the one for a today that is not played yet.
  static final String KEY_LABEL = "label";
  static final String KEY_LABEL_COLD = "labelCold";
  // Comma-joined ISO dates (yyyy-MM-dd, local days as the server counts them).
  static final String KEY_PLAYED = "played";
  static final String KEY_FROZEN = "frozen";
  // "warm" or "freeze": which banner. Decided by the app, which knows about freezes and risk.
  static final String KEY_MOOD = "mood";

  static final String ACTION_MIDNIGHT = "com.elmekina.game.WIDGET_MIDNIGHT";

  // At and above this height the launcher has given two rows and the tall form fits (it needs
  // ~110dp); under it the one-row form takes over.
  private static final int TALL_MIN_DP = 125;

  @Override
  public void onUpdate(Context context, AppWidgetManager manager, int[] ids) {
    for (int id : ids) manager.updateAppWidget(id, forOptions(context, manager.getAppWidgetOptions(id)));
    armMidnight(context);
  }

  /** The player resized it: re-pick the form for the new height. */
  @Override
  public void onAppWidgetOptionsChanged(Context context, AppWidgetManager manager, int id, Bundle options) {
    manager.updateAppWidget(id, forOptions(context, options));
  }

  /**
   * Which form, for the box the launcher is offering. The options carry BOTH orientations' sizes,
   * and a 2x2 is a very different shape in each (172x233dp portrait, 332x137dp landscape on a
   * Pixel). From Android 12 a RemoteViews can hold one layout per size and the launcher picks as
   * the phone turns; before that the choice is made once, on the smaller height, so nothing clips.
   */
  static RemoteViews forOptions(Context context, Bundle options) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && options != null) {
      ArrayList<SizeF> sizes = options.getParcelableArrayList(AppWidgetManager.OPTION_APPWIDGET_SIZES);
      if (sizes != null && !sizes.isEmpty()) {
        Map<SizeF, RemoteViews> bySize = new HashMap<>();
        for (SizeF size : sizes) bySize.put(size, build(context, size.getHeight() >= TALL_MIN_DP));
        return new RemoteViews(bySize);
      }
    }
    int minHeightDp = options == null ? 0 : options.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT, 0);
    return build(context, minHeightDp == 0 || minHeightDp >= TALL_MIN_DP);   // no options (preview): the default form
  }

  @Override
  public void onReceive(Context context, Intent intent) {
    if (ACTION_MIDNIGHT.equals(intent.getAction())) { refreshAll(context); return; }
    super.onReceive(context, intent);
  }

  static RemoteViews build(Context context, boolean tall) {
    SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    int count = prefs.getInt(KEY_COUNT, 0);
    Set<String> played = split(prefs.getString(KEY_PLAYED, ""));
    boolean playedToday = played.contains(iso(Calendar.getInstance()));
    boolean freeze = "freeze".equals(prefs.getString(KEY_MOOD, "warm"));

    // Empty means the app has never pushed — a brand new install, before any game. Fall back to
    // the device locale so the widget never sits there with a number and no words under it.
    String label = prefs.getString(playedToday ? KEY_LABEL : KEY_LABEL_COLD, "");
    if (label == null || label.isEmpty()) label = prefs.getString(KEY_LABEL, "");
    if (label == null || label.isEmpty()) label = context.getString(R.string.widget_default);

    RemoteViews views = new RemoteViews(context.getPackageName(), tall ? R.layout.widget_streak_tall : R.layout.widget_streak);
    views.setImageViewResource(R.id.widget_art, freeze ? R.drawable.widget_freeze : R.drawable.widget_warm);
    views.setTextViewText(R.id.widget_count, String.valueOf(count));
    views.setTextViewText(R.id.widget_label, label);
    // A cold streak says so at a glance: the number drains to the muted paper colour and the flame
    // dims. Frozen, the number goes ice-blue to match the banner. Nothing else changes, so the
    // widget never looks broken — just unlit.
    views.setTextColor(R.id.widget_count, count <= 0 ? 0xFFD9CAB2 : freeze ? 0xFF9CD1FF : 0xFFFFC24A);
    views.setInt(R.id.widget_fire, "setImageAlpha", count > 0 && playedToday ? 255 : 130);

    Intent open = new Intent(context, MainActivity.class);
    open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
    // the root carries @android:id/background, which the launcher needs to clip our corners
    views.setOnClickPendingIntent(android.R.id.background,
        PendingIntent.getActivity(context, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
    return views;
  }

  /** Called by the plugin after every change: repaint every instance the launcher holds. */
  static void refreshAll(Context context) {
    AppWidgetManager manager = AppWidgetManager.getInstance(context);
    int[] ids = manager.getAppWidgetIds(new ComponentName(context, StreakWidget.class));
    for (int id : ids) manager.updateAppWidget(id, forOptions(context, manager.getAppWidgetOptions(id)));
    if (ids.length > 0) armMidnight(context);
  }

  /**
   * One inexact RTC alarm at the next local midnight (plus a minute of slack for the clock), which
   * lands as ACTION_MIDNIGHT in onReceive. Non-waking: if the phone is asleep it repaints when it
   * next wakes, which is when anyone would look. Re-armed after every repaint, so it is never
   * more than one alarm and it survives the widget being re-added.
   */
  private static void armMidnight(Context context) {
    AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
    if (am == null) return;
    Calendar next = Calendar.getInstance();
    next.add(Calendar.DAY_OF_MONTH, 1);
    next.set(Calendar.HOUR_OF_DAY, 0); next.set(Calendar.MINUTE, 1); next.set(Calendar.SECOND, 0); next.set(Calendar.MILLISECOND, 0);
    Intent tick = new Intent(context, StreakWidget.class).setAction(ACTION_MIDNIGHT);
    PendingIntent pi = PendingIntent.getBroadcast(context, 1, tick, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    am.set(AlarmManager.RTC, next.getTimeInMillis(), pi);
  }

  private static String iso(Calendar c) {
    return String.format(Locale.US, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH));
  }

  private static Set<String> split(String csv) {
    if (csv == null || csv.isEmpty()) return Collections.emptySet();
    return new HashSet<>(Arrays.asList(csv.split(",")));
  }
}
