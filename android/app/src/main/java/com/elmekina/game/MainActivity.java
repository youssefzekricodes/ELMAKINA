package com.elmekina.game;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // Before super: Capacitor collects registered plugins during its own onCreate.
    registerPlugin(StreakWidgetPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
