// TimerAlarmModule — Reduction's cooking timers as AlarmKit alarms (iOS 26+).
//
// Deliberately THIN: schedule one alarm at a fixed date, list what is
// scheduled, cancel by id, and the authorization round trip. Which alarms
// should exist is decided in JS (lib/timerAlertPolicy.ts, pure and tested)
// and reconciled against `list`, exactly as the local-notification arm is.
//
// ALERT-ONLY PRESENTATION, ON PURPOSE. A countdown presentation (the timer
// counting down on the Lock Screen and in the Dynamic Island) needs a widget
// extension rendering a Live Activity for these same attributes; without
// one the system may dismiss the alarm. This module schedules no
// countdown, so it needs no extension: the alarm rings at the fixed date
// with the system's full alarm UI (Lock Screen, Apple Watch, through Silent
// mode and Focus). The countdown view is a later step with its own target.
//
// NEVER COMPILED IN THE CONTAINER IT WAS WRITTEN IN (Linux, no Xcode): the
// first compile is an EAS build. Every AlarmKit signature here was checked
// against Apple's documentation (Oct 5), including which iOS introduced it.
// Built with an SDK older than iOS 26 the whole AlarmKit half compiles out
// (canImport) and the module reports itself unavailable.

import ExpoModulesCore
import Foundation
#if canImport(AlarmKit)
import AlarmKit
import ActivityKit
import SwiftUI

@available(iOS 26.0, *)
struct ReductionTimerMetadata: AlarmMetadata {
  init() {}
}
#endif

public class TimerAlarmModule: Module {
  public func definition() -> ModuleDefinition {
    Name("TimerAlarm")

    Function("isAvailable") { () -> Bool in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) { return true }
      #endif
      return false
    }

    AsyncFunction("authorizationState") { () -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        return TimerAlarmModule.describe(AlarmManager.shared.authorizationState)
      }
      #endif
      return "unavailable"
    }

    AsyncFunction("requestAuthorization") { () async throws -> String in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        let state = try await AlarmManager.shared.requestAuthorization()
        return TimerAlarmModule.describe(state)
      }
      #endif
      return "unavailable"
    }

    // Every alarm this app has scheduled, as { id, fireAt } with fireAt in
    // epoch milliseconds (0 when the alarm has no fixed date, which this
    // module never schedules — JS treats it as stale and replaces it).
    AsyncFunction("list") { () throws -> [[String: Any]] in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        return try AlarmManager.shared.alarms.map { alarm -> [String: Any] in
          var fireAt: Double = 0
          if case .fixed(let date)? = alarm.schedule {
            fireAt = date.timeIntervalSince1970 * 1000
          }
          return ["id": alarm.id.uuidString.lowercased(), "fireAt": fireAt]
        }
      }
      #endif
      return []
    }

    AsyncFunction("schedule") { (id: String, fireAt: Double, title: String, stopLabel: String, tint: String) async throws -> Void in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        guard let uuid = UUID(uuidString: id) else {
          throw Exception(name: "BadAlarmId", description: "Not a UUID: \(id)")
        }
        let alert = TimerAlarmModule.alert(title: title, stopLabel: stopLabel)
        let attributes = AlarmAttributes<ReductionTimerMetadata>(
          presentation: AlarmPresentation(alert: alert),
          tintColor: TimerAlarmModule.color(hex: tint)
        )
        let configuration = AlarmManager.AlarmConfiguration(
          countdownDuration: nil,
          schedule: .fixed(Date(timeIntervalSince1970: fireAt / 1000)),
          attributes: attributes,
          sound: .default
        )
        _ = try await AlarmManager.shared.schedule(id: uuid, configuration: configuration)
        return
      }
      #endif
      throw Exception(name: "AlarmKitUnavailable", description: "AlarmKit needs iOS 26")
    }

    // Cancel a scheduled alarm, or stop one that is ringing. An id that is
    // not scheduled is not an error: the reconcile may race the system
    // removing an alarm that just fired.
    AsyncFunction("cancel") { (id: String) throws -> Void in
      #if canImport(AlarmKit)
      if #available(iOS 26.0, *) {
        guard let uuid = UUID(uuidString: id) else { return }
        let manager = AlarmManager.shared
        guard let alarm = try manager.alarms.first(where: { $0.id == uuid }) else { return }
        if case .alerting = alarm.state {
          try manager.stop(id: uuid)
        } else {
          try manager.cancel(id: uuid)
        }
      }
      #endif
    }
  }

  #if canImport(AlarmKit)
  @available(iOS 26.0, *)
  private static func describe(_ state: AlarmManager.AuthorizationState) -> String {
    switch state {
    case .authorized: return "authorized"
    case .denied: return "denied"
    case .notDetermined: return "notDetermined"
    @unknown default: return "denied"
    }
  }

  // iOS 26.1 dropped the stop button from the alert (the system draws its
  // own) and deprecated the initializer that takes one; 26.0 requires it.
  @available(iOS 26.0, *)
  private static func alert(title: String, stopLabel: String) -> AlarmPresentation.Alert {
    let text = LocalizedStringResource(stringLiteral: title)
    if #available(iOS 26.1, *) {
      return AlarmPresentation.Alert(title: text)
    }
    return AlarmPresentation.Alert(
      title: text,
      stopButton: AlarmButton(
        text: LocalizedStringResource(stringLiteral: stopLabel),
        textColor: .white,
        systemImageName: "checkmark.circle.fill"
      )
    )
  }

  private static func color(hex: String) -> Color {
    let s = hex.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
    guard s.count == 6, let v = UInt64(s, radix: 16) else { return .orange }
    return Color(
      red: Double((v >> 16) & 0xFF) / 255,
      green: Double((v >> 8) & 0xFF) / 255,
      blue: Double(v & 0xFF) / 255
    )
  }
  #endif
}
