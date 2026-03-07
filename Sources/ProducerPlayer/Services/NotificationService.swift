import Foundation
import UserNotifications

final class NotificationService {
    private let center = UNUserNotificationCenter.current()

    func requestAuthorizationIfNeeded() {
        center.getNotificationSettings { [center] settings in
            guard settings.authorizationStatus == .notDetermined else { return }
            center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
        }
    }

    func notifyRerender(songTitle: String, versionName: String) {
        let content = UNMutableNotificationContent()
        content.title = "Re-render detected"
        content.body = "\(songTitle) → \(versionName)"
        content.sound = .default

        let request = UNNotificationRequest(
            identifier: "rerender-\(UUID().uuidString)",
            content: content,
            trigger: nil
        )
        center.add(request)
    }
}
