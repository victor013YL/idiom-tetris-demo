// Data only: loading, validation, random selection and lookup.
const FALLBACK = [{ id: 'idiom_001', word: '一帆风顺', characters: ['一', '帆', '风', '顺'] }];
const copy = idiom => ({ ...idiom, characters: [...idiom.characters] });

export class IdiomManager {
  #idioms;

  constructor(data) {
    const ids = new Set();
    if (!Array.isArray(data) || data.length === 0) throw new Error('Empty or invalid idiom list');
    for (const item of data) {
      if (!item || typeof item.id !== 'string' || !item.id.trim() || ids.has(item.id) ||
          typeof item.word !== 'string' || !Array.isArray(item.characters) ||
          item.characters.length !== 4 ||
          !item.characters.every(char => typeof char === 'string' && /^\p{Script=Han}$/u.test(char)) ||
          item.characters.join('') !== item.word) {
        throw new Error('Each idiom needs a unique id and exactly four matching Han characters');
      }
      ids.add(item.id);
    }
    this.#idioms = data.map(copy);
  }

  static async load(url = new URL('../data/idioms.json', import.meta.url), fetchData = globalThis.fetch) {
    try {
      const response = await fetchData(url, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return new IdiomManager(await response.json());
    } catch (error) {
      console.error('[IdiomManager] Failed to load idioms.json; using 一帆风顺 fallback.', error);
      return new IdiomManager(FALLBACK);
    }
  }

  random() {
    return copy(this.#idioms[Math.floor(Math.random() * this.#idioms.length)]);
  }

  getById(id) {
    const idiom = this.#idioms.find(item => item.id === id);
    return idiom ? copy(idiom) : null;
  }
}
