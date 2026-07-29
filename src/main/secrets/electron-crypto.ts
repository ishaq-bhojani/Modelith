import { safeStorage } from 'electron'
import type { SecretCrypto } from './keystore.js'

export const electronCrypto: SecretCrypto = {
  isAvailable: () => safeStorage.isEncryptionAvailable(),
  encrypt: (plain) => safeStorage.encryptString(plain),
  decrypt: (cipher) => safeStorage.decryptString(cipher),
}
