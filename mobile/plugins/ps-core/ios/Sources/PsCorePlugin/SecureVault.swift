// SPDX-License-Identifier: AGPL-3.0-only
import Foundation
import Security

/// The account vault (Sony and Xbox sessions) as one Keychain item. It is readable
/// after the first unlock and bound to this device, so it never travels in a
/// backup or to a new phone.
enum SecureVault {
    private static let base: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: "app.hargan.cast.vault",
        kSecAttrAccount as String: "vault",
    ]

    static func load() -> String? {
        var query = base
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func save(_ text: String) -> Bool {
        let attributes: [String: Any] = [
            kSecValueData as String: Data(text.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let status = SecItemUpdate(base as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            let item = base.merging(attributes) { $1 }
            return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
        }
        return status == errSecSuccess
    }
}
