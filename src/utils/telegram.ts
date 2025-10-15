export const sendTelegramNotification = async (message: string) => {
  console.log(
    '🚀 sendTelegramNotification called with message:',
    message.substring(0, 50) + '...'
  );
  try {
    // You'll need to set these environment variables
    const botToken =
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_TOKEN || 'YOUR_BOT_TOKEN_HERE';
    const chatId = process.env.NEXT_PUBLIC_TELEGRAM_CHAT_ID || 'NoT_SET';

    console.log('🔄 Sending Telegram notification...');
    console.log('Bot token configured:', botToken !== 'YOUR_BOT_TOKEN_HERE');
    console.log('Chat ID:', chatId);

    if (botToken === 'YOUR_BOT_TOKEN_HERE') {
      console.log(
        '❌ Telegram notification skipped - bot token not configured'
      );
      return { success: false, error: 'Bot token not configured' };
    }

    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    console.log('📡 Telegram API URL:', telegramUrl);

    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'HTML',
      }),
    });

    console.log('📨 Telegram response status:', response.status);

    if (response.ok) {
      console.log('✅ Telegram notification sent successfully');
      return { success: true };
    } else {
      const errorData = await response.text();
      console.error('❌ Telegram API error:', response.status, errorData);
      return {
        success: false,
        error: `Telegram API error: ${response.status} - ${errorData}`,
      };
    }
  } catch (error) {
    console.error('❌ Failed to send Telegram notification:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
};
