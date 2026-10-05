# The app's own AlarmKit bridge (lib/timerAlarm.ts is its only caller).
# AlarmKit exists from iOS 26; the app runs on older iOS too, so the
# framework is WEAK-linked and every use is behind #available — on an older
# phone the module loads and reports itself unavailable.
Pod::Spec.new do |s|
  s.name           = 'TimerAlarm'
  s.version        = '1.0.0'
  s.summary        = 'Cooking timers as system alarms (AlarmKit).'
  s.description    = 'Schedules, lists and cancels AlarmKit alarms for Reduction timers.'
  s.license        = 'UNLICENSED'
  s.author         = 'Reduction'
  s.homepage       = 'https://recipereduction.com'
  s.platforms      = { :ios => '16.4' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.weak_frameworks = 'AlarmKit'

  s.source_files = '**/*.swift'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
