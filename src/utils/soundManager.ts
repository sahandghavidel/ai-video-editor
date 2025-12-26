/**
 * Sound utilities for playing alert tones in the browser
 * Uses Web Audio API to generate tones programmatically
 */

declare global {
  interface Window {
    webkitAudioContext?: typeof AudioContext;
  }
}

class SoundManager {
  private audioContext: AudioContext | null = null;

  private getAudioContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new (window.AudioContext ||
        window.webkitAudioContext)();
    }
    return this.audioContext;
  }

  /**
   * Play a success/completion sound - pleasant ascending tone
   */
  async playSuccessSound(): Promise<void> {
    try {
      const audioContext = this.getAudioContext();

      // Resume context if suspended (required by some browsers)
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      // Create oscillator for the tone
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      // Connect nodes
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      // Configure the sound - pleasant ascending melody
      const now = audioContext.currentTime;

      // First note (C4)
      oscillator.frequency.setValueAtTime(261.63, now);
      oscillator.frequency.setValueAtTime(293.66, now + 0.1); // D4
      oscillator.frequency.setValueAtTime(329.63, now + 0.2); // E4
      oscillator.frequency.setValueAtTime(392.0, now + 0.3); // G4

      // Volume envelope
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.6, now + 0.05); // Quick attack
      gainNode.gain.setValueAtTime(0.6, now + 0.35); // Sustain
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.5); // Decay

      // Start and stop
      oscillator.start(now);
      oscillator.stop(now + 0.5);
    } catch (error) {
      console.warn('Could not play success sound:', error);
      // Fallback: try to play system notification if available
      this.fallbackNotification();
    }
  }

  /**
   * Play an error sound - descending tone
   */
  async playErrorSound(): Promise<void> {
    try {
      const audioContext = this.getAudioContext();

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      const now = audioContext.currentTime;

      // Descending tone (E4 to C4)
      oscillator.frequency.setValueAtTime(329.63, now);
      oscillator.frequency.setValueAtTime(293.66, now + 0.1);
      oscillator.frequency.setValueAtTime(261.63, now + 0.2);

      // Volume envelope
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.7, now + 0.05);
      gainNode.gain.setValueAtTime(0.7, now + 0.25);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);

      oscillator.start(now);
      oscillator.stop(now + 0.3);
    } catch (error) {
      console.warn('Could not play error sound:', error);
    }
  }

  /**
   * Play a notification sound - simple beep
   */
  async playNotificationSound(): Promise<void> {
    try {
      const audioContext = this.getAudioContext();

      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      const now = audioContext.currentTime;

      // Simple notification tone (A4)
      oscillator.frequency.setValueAtTime(440, now);

      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.5, now + 0.05);
      gainNode.gain.setValueAtTime(0.5, now + 0.15);
      gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);

      oscillator.start(now);
      oscillator.stop(now + 0.2);
    } catch (error) {
      console.warn('Could not play notification sound:', error);
    }
  }

  /**
   * Fallback notification using browser notification API
   */
  private fallbackNotification(): void {
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Batch Operation Complete', {
          body: 'Your batch operation has finished!',
          icon: '/favicon.ico',
        });
      }
    } catch (error) {
      // Silent fallback - notification not available
    }
  }
}

// Export singleton instance
export const soundManager = new SoundManager();

// Convenience functions
export const playSuccessSound = () => soundManager.playSuccessSound();
export const playErrorSound = () => soundManager.playErrorSound();
export const playNotificationSound = () => soundManager.playNotificationSound();
