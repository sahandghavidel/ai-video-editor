export interface TelegramNotificationResult {
  success: boolean;
  error?: string;
}

export const sendTelegramNotification = async (
  message: string,
): Promise<TelegramNotificationResult> => {
  const trimmedMessage = String(message || '').trim();

  if (!trimmedMessage) {
    return { success: false, error: 'Message is required' };
  }

  try {
    const response = await fetch('/api/notifications/telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message: trimmedMessage }),
    });

    const payload = (await response.json().catch(() => null)) as {
      success?: unknown;
      error?: unknown;
    } | null;

    if (!response.ok) {
      return {
        success: false,
        error:
          typeof payload?.error === 'string'
            ? payload.error
            : `Failed to send Telegram notification (${response.status})`,
      };
    }

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
