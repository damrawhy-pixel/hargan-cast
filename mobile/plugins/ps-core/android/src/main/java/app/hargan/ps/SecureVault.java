// SPDX-License-Identifier: AGPL-3.0-only
package app.hargan.ps;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The account vault (Sony and Xbox sessions) as one AES-GCM sealed blob. The key
 * lives in the Android Keystore and never leaves it; the blob sits in private app
 * preferences, which the manifest keeps out of backups and device transfers.
 */
final class SecureVault {
    private static final String KEY_ALIAS = "hargan-vault";
    private static final String PREFS = "hargan-vault";
    private static final String ENTRY = "vault";
    private static final String CIPHER = "AES/GCM/NoPadding";
    private static final int IV_BYTES = 12;
    private static final int TAG_BITS = 128;

    private final SharedPreferences prefs;

    SecureVault(Context context) {
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private static SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return generator.generateKey();
    }

    /** The vault's JSON, or null when there is none or it can no longer be opened. */
    String load() {
        String stored = prefs.getString(ENTRY, null);
        if (stored == null) return null;
        try {
            byte[] blob = Base64.decode(stored, Base64.NO_WRAP);
            Cipher cipher = Cipher.getInstance(CIPHER);
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(TAG_BITS, blob, 0, IV_BYTES));
            return new String(cipher.doFinal(blob, IV_BYTES, blob.length - IV_BYTES), StandardCharsets.UTF_8);
        } catch (Exception e) {
            // A key the Keystore no longer has (a reset device, a restored app):
            // the accounts sign in again.
            prefs.edit().remove(ENTRY).commit();
            return null;
        }
    }

    void save(String data) throws Exception {
        Cipher cipher = Cipher.getInstance(CIPHER);
        // The Keystore chooses a fresh IV for every encryption.
        cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = cipher.getIV();
        if (iv.length != IV_BYTES) throw new IllegalStateException("unexpected IV size");
        byte[] sealed = cipher.doFinal(data.getBytes(StandardCharsets.UTF_8));
        byte[] blob = ByteBuffer.allocate(iv.length + sealed.length).put(iv).put(sealed).array();
        if (!prefs.edit().putString(ENTRY, Base64.encodeToString(blob, Base64.NO_WRAP)).commit()) {
            throw new IllegalStateException("vault not written");
        }
    }
}
