export const MIN_PASSPHRASE_CHARACTERS = 12;

export function validateNewPassphrase(
  passphrase: string,
  confirmation: string,
): string | null {
  if (Array.from(passphrase).length < MIN_PASSPHRASE_CHARACTERS) {
    return "Use a passphrase with at least 12 characters.";
  }

  if (passphrase !== confirmation) {
    return "The passphrases do not match.";
  }

  return null;
}
