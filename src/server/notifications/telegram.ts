import 'server-only';

export interface TelegramNotificationResult {
  success: boolean;
  error?: string;
}

const PLACEHOLDER_BOT_TOKEN = 'YOUR_BOT_TOKEN_HERE';
const PLACEHOLDER_CHAT_ID = 'NoT_SET';

const getBotToken = () =>
  (
    process.env.TELEGRAM_BOT_TOKEN ||
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN ||
    ''
  ).trim();

const getChatId = () =>
  (
    process.env.TELEGRAM_CHAT_ID ||
    process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID ||
    ''
  ).trim();

const isPlaceholder = (value: string) =>
  !value ||
  value === PLACEHOLDER_BOT_TOKEN ||
  value === PLACEHOLDER_CHAT_ID ||
  value === 'Not Set';

const maskChatId = (chatId: string) => {
  if (!chatId) return 'Not Set';
  if (chatId.length <= 4) return '****';
  return `${'*'.repeat(chatId.length - 4)}${chatId.slice(-4)}`;
};

export const getTelegramConfigStatus = () => {
  const botToken = getBotToken();
  const chatId = getChatId();

  const botTokenConfigured = !isPlaceholder(botToken);
  const chatIdConfigured = !isPlaceholder(chatId);

  return {
    configured: botTokenConfigured && chatIdConfigured,
    botTokenConfigured,
    chatIdConfigured,
    botTokenSource: process.env.TELEGRAM_BOT_TOKEN
      ? 'TELEGRAM_BOT_TOKEN'
      : process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN
        ? 'NEXT_PUBLIC_TELEGRAM_BOT_TOKEN (fallback)'
        : 'not-set',
    chatIdSource: process.env.TELEGRAM_CHAT_ID
      ? 'TELEGRAM_CHAT_ID'
      : process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID
        ? 'NEXT_PUBLIC_TELEGRAM_CHAT_ID (fallback)'
        : 'not-set',
    chatIdPreview: chatIdConfigured ? maskChatId(chatId) : 'Not Set',
  };
};

export const sendTelegramNotificationServer = async (
  message: string,
): Promise<TelegramNotificationResult> => {
  const trimmedMessage = String(message || '').trim();

  if (!trimmedMessage) {
    return { success: false, error: 'Message is required' };
  }

  const botToken = getBotToken();
  const chatId = getChatId();

  if (isPlaceholder(botToken) || isPlaceholder(chatId)) {
    return {
      success: false,
      error:
        'Telegram credentials are not configured. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID.',
    };
  }

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: trimmedMessage,
          parse_mode: 'HTML',
        }),
      },
    );

    if (response.ok) {
      return { success: true };
    }

    const errorText = await response
      .text()
      .catch(() => 'Unknown Telegram API error');
    return {
      success: false,
      error: `Telegram API error: ${response.status} - ${errorText}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
