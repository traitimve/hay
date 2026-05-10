export class OfflineTranslator {
  private translator: any = null;

  async initialize(sourceLang: string, targetLang: string, onProgress?: (progress: number) => void): Promise<boolean> {
    const src = sourceLang.split('-')[0];
    const tgt = targetLang.split('-')[0];

    // Try new window.ai.translator
    if ('ai' in window && 'translator' in (window as any).ai) {
      const ai = (window as any).ai;
      try {
        const capabilities = await ai.translator.capabilities();
        const canTranslate = capabilities.languagePairAvailable(src, tgt);
        
        if (canTranslate !== 'no') {
          this.translator = await ai.translator.create({
            sourceLanguage: src,
            targetLanguage: tgt,
            monitor(m: any) {
              m.addEventListener('downloadprogress', (e: any) => {
                const p = (e.loaded / e.total) * 100;
                if (onProgress) onProgress(p);
              });
            }
          });
          return true;
        }
      } catch (e) {
        console.warn("window.ai.translator failed", e);
      }
    }

    // Try window.translation
    if ('translation' in window) {
      const translation = (window as any).translation;
      try {
        const canTranslate = await translation.canTranslate({ sourceLanguage: src, targetLanguage: tgt });
        if (canTranslate !== 'no') {
          this.translator = await translation.createTranslator({ sourceLanguage: src, targetLanguage: tgt });
          return true;
        }
      } catch (e) {
        console.warn("window.translation failed", e);
      }
    }

    return false;
  }

  async translate(text: string): Promise<string> {
    if (!this.translator) throw new Error("Offline Translator not initialized or not supported for this pair.");
    return await this.translator.translate(text);
  }

  destroy() {
    if (this.translator && typeof this.translator.destroy === 'function') {
      this.translator.destroy();
    }
  }
}
