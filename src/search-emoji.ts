import { assetData } from "@project-gauntlet/api/helpers";
import type { EmojiImageArray, ReducedEmojiList } from "./type";
import { Fzf, Tiebreaker } from "fzf";

const commonEmojis = [
  "😂",
  "❤️",
  "🤣",
  "👍",
  "😭",
  "🙏",
  "😘",
  "🥰",
  "😍",
  "😊",
  "🎉",
  "😁",
  "💕",
  "🥺",
  "😅",
  "🔥",
  "✨",
  "💖",
  "👀",
  "😋",
  "🙂",
  "😳",
  "🥳",
  "😎",
] as const;

interface EmojiFuzzySearchEntry {
  id: string;
  type: "name" | "keyword" | "category";
  index: number[];
}

/**
 * EmojiSearcher provides fast search over emojis.
 */
export class EmojiSearcher {
  private emojiList: ReducedEmojiList;
  private emojiFzf: Fzf<EmojiFuzzySearchEntry[]>;

  static async createEmoijSearcher() {
    const data = await assetData("reduced-emoji.gz");
    const ds = new DecompressionStream("gzip");
    const blob = new Blob([data]);
    const decompressedStream = blob.stream().pipeThrough(ds);
    const res = await new Response(decompressedStream).text();
    return new EmojiSearcher(JSON.parse(res));
  }

  constructor(emojiList: ReducedEmojiList) {
    this.emojiList = emojiList;
    this.emojiFzf = new Fzf(this.buildFuzzySearchEntries(), {
      fuzzy: false,
      selector: (entry) => entry.id,
      tiebreakers: [this.byEmojiSearchType],
    });
  }

  private byEmojiSearchType: Tiebreaker<EmojiFuzzySearchEntry> = (a, b) => {
    if (a.item.type === b.item.type) return 0;
    if (a.item.type === "name") return -1;
    if (b.item.type === "name") return 1;
    if (a.item.type === "keyword") return -1;
    if (b.item.type === "keyword") return 1;
    return 0;
  };

  private buildFuzzySearchEntries() {
    type Entries = Record<
      string,
      { type: "name" | "keyword"; index: number[] }
    >;
    const nameEntries: Entries = {};
    for (let i = 0; i < this.emojiList.emojis.length; i++) {
      const emoji = this.emojiList.emojis[i]!;
      const name = emoji[1];
      if (nameEntries[name]) {
        nameEntries[name].index.push(i);
      } else {
        nameEntries[name] = { type: "name", index: [i] };
      }
    }

    const keywordEntries: Entries = {};
    for (let i = 0; i < this.emojiList.emojis.length; i++) {
      const emoji = this.emojiList.emojis[i]!;
      for (const keywordIdx of emoji[4]) {
        const keyword = this.emojiList.keywords[keywordIdx]!;
        if (keywordEntries[keyword]) {
          keywordEntries[keyword].index.push(i);
        } else {
          keywordEntries[keyword] = { type: "keyword", index: [i] };
        }
      }
    }

    const emojiFuzzySearchEntries: EmojiFuzzySearchEntry[] = [];
    for (const [id, entry] of Object.entries(nameEntries)) {
      emojiFuzzySearchEntries.push({ id, type: "name", index: entry.index });
    }
    for (const [id, entry] of Object.entries(keywordEntries)) {
      emojiFuzzySearchEntries.push({ id, type: "keyword", index: entry.index });
    }
    return emojiFuzzySearchEntries;
  }

  /**
   * Search emojis by a user supplied string.
   */
  search(input: string) {
    const results = this.emojiFzf.find(input);
    const resultMap = new Map<number, (typeof results)[0]>();
    for (const result of results) {
      for (const id of result.item.index) {
        resultMap.set(id, result);
      }
    }
    const resultUnique = Array.from(resultMap.entries());
    return resultUnique
      .sort((a, b) => {
        const aScore = a[1].score;
        const bScore = b[1].score;
        if (aScore === bScore) return a[0] - b[0];
        return bScore - aScore;
      })
      .map(([id, entry]) => this.intoHumanReadable(id, entry.score));
  }

  getAll() {
    return this.emojiList.emojis.map((_, i) => this.intoHumanReadable(i));
  }

  getCommon() {
    return commonEmojis
      .map((e) => {
        const idx = this.emojiList.emojis.findIndex(([emoji]) => emoji === e);
        if (idx === -1) return null;
        return this.intoHumanReadable(idx);
      })
      .filter(Boolean) as ReturnType<typeof this.intoHumanReadable>[];
  }

  /** Convert internal emoji representation to a human‑readable object */
  intoHumanReadable(emojiIdx: number, weight?: number) {
    const emoji = this.emojiList.emojis[emojiIdx]!;
    return {
      emoji: emoji[0],
      name: emoji[1],
      category: this.emojiList.category[emoji[2]],
      subcategory: this.emojiList.subCategory[emoji[2]]![emoji[3]],
      keywords: emoji[4].map((k) => this.emojiList.keywords[k]),
      image: this.fromEmojiImageArr(emoji[5]),
      weight,
    };
  }

  private fromEmojiImageArr(arr: EmojiImageArray) {
    if (!arr) return null;
    return {
      image: arr[4],
      apple: arr[0] === 1,
      google: arr[1] === 1,
      twitter: arr[2] === 1,
      facebook: arr[3] === 1,
    };
  }
}
