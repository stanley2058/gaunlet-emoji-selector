import { assetData } from "@project-gauntlet/api/helpers";
import type { EmojiImageArray, ReducedEmojiList } from "./type";

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

/**
 * Trie node used for substring (partial) matching.
 * This is a suffix‑trie (also called a "trie of all suffixes")
 * where each node stores the set of emoji indices that contain the
 * substring represented by the path from the root to that node.
 *
 * The trie is built once in the constructor and then used
 * for O(m) substring search (m = length of the query).
 */
interface TrieNode {
  /** child nodes keyed by a single character */
  children: Record<string, TrieNode>;
  /** indices of emojis that contain the substring represented by this node */
  output: number[];
}

/**
 * EmojiSearcher provides fast search over emojis.
 *
 * Ranking (higher weight = higher priority):
 *   5 – exact match on emoji name
 *   4 – exact match on emoji keyword
 *   3 – partial (substring) match on emoji name
 *   2 – partial (substring) match on emoji keyword
 *   1 – partial (substring) match on category/subcategory
 */
export class EmojiSearcher {
  private emojiList: ReducedEmojiList;
  /** root of the suffix‑trie for emoji names */
  private nameTrieRoot: TrieNode;
  /** root of the suffix‑trie for keywords */
  private keywordTrieRoot: TrieNode;
  /** root of the suffix‑trie for categories/subcategories */
  private categoryTrieRoot: TrieNode;
  /** map for exact name lookup (weight 5) */
  private nameMap: Record<string, number> = {};

  static async createEmoijSearcher() {
    const data = await assetData("reduced-emoji.gz");
    const ds = new DecompressionStream("gzip");
    const blob = new Blob([data]);
    const decompressedStream = blob.stream().pipeThrough(ds);
    const res = await new Response(decompressedStream).text();
    return new EmojiSearcher(JSON.parse(res));
  }

  constructor(
    emojiList: ReducedEmojiList,
    cachedJson?: ReturnType<typeof EmojiSearcher.prototype.toJSON>,
  ) {
    this.emojiList = emojiList;

    if (cachedJson) {
      this.nameTrieRoot = cachedJson.nameTrieRoot;
      this.keywordTrieRoot = cachedJson.keywordTrieRoot;
      this.categoryTrieRoot = cachedJson.categoryTrieRoot;
      this.nameMap = cachedJson.nameMap;
    } else {
      this.nameTrieRoot = { children: {}, output: [] };
      this.keywordTrieRoot = { children: {}, output: [] };
      this.categoryTrieRoot = { children: {}, output: [] };
      this.buildTries();
    }
  }

  /** Build suffix‑tries for names, keywords, and categories */
  private buildTries() {
    const { emojis, keywords, category, subCategory } = this.emojiList;

    // Build name trie and exact name map
    for (let i = 0; i < emojis.length; i++) {
      const emoji = emojis[i]!;
      const name = emoji[1];
      this.nameMap[name] = i;
      this.insertIntoTrie(this.nameTrieRoot, name.toLowerCase(), i);

      // Build keyword trie
      for (const keywordIdx of emoji[4]) {
        const keyword = keywords[keywordIdx]!;
        this.insertIntoTrie(this.keywordTrieRoot, keyword.toLowerCase(), i);
      }

      // Build category/subcategory trie
      const categoryName = category[emoji[2]]!;
      const subcategoryName = subCategory[emoji[2]]![emoji[3]]!;
      this.insertIntoTrie(this.categoryTrieRoot, categoryName.toLowerCase(), i);
      this.insertIntoTrie(
        this.categoryTrieRoot,
        subcategoryName.toLowerCase(),
        i,
      );
    }
  }

  /** Insert all suffixes of a string into the given trie */
  private insertIntoTrie(root: TrieNode, text: string, emojiIdx: number) {
    for (let start = 0; start < text.length; start++) {
      let node = root;
      for (let pos = start; pos < text.length; pos++) {
        const ch = text[pos]!;
        if (!node.children[ch]) {
          node.children[ch] = { children: {}, output: [] };
        }
        node = node.children[ch]!;
        if (!node.output.includes(emojiIdx)) {
          node.output.push(emojiIdx);
        }
      }
    }
  }

  /** Search for a substring in the given trie */
  private searchTrie(root: TrieNode, input: string): number[] {
    let node: TrieNode | undefined = root;
    for (let i = 0; i < input.length && node; i++) {
      const ch = input[i]!;
      node = node.children[ch];
    }
    return node ? node.output : [];
  }

  /**
   * Search emojis by a user supplied string.
   * Uses a voting system where multiple matches accumulate weight.
   * Only returns results with combined weight > 3.
   */
  search(input: string) {
    const resultVotes: Record<number, number> = {};
    const lowerInput = input.trim().toLowerCase();
    if (lowerInput === "") {
      return this.emojiList.emojis.map((_, i) => this.intoHumanReadable(i));
    }
    const exactKeywordIdx = this.emojiList.keywords.indexOf(input);

    const addVote = (idx: number, weight: number) => {
      resultVotes[idx] = (resultVotes[idx] || 0) + weight;
    };

    // 1. Exact name match (weight 5)
    const exactIdx = this.nameMap[input];
    if (exactIdx !== undefined) addVote(exactIdx, 5);

    // 2. Exact keyword match (weight 4)
    if (exactKeywordIdx !== -1) {
      for (let i = 0; i < this.emojiList.emojis.length; i++) {
        const emoji = this.emojiList.emojis[i]!;
        if (emoji[4].includes(exactKeywordIdx)) addVote(i, 4);
      }
    }

    // 3. Partial name match (weight 3)
    const nameMatches = this.searchTrie(this.nameTrieRoot, lowerInput);
    for (const idx of nameMatches) {
      addVote(idx, 3);
    }

    // 4. Partial keyword match (weight 2)
    const keywordMatches = this.searchTrie(this.keywordTrieRoot, lowerInput);
    for (const idx of keywordMatches) {
      addVote(idx, 2);
    }

    // 5. Partial category/subcategory match (weight 1)
    const categoryMatches = this.searchTrie(this.categoryTrieRoot, lowerInput);
    for (const idx of categoryMatches) {
      addVote(idx, 1);
    }

    // Filter results with combined weight > 3 and sort by weight
    return Object.entries(resultVotes)
      .filter(([, weight]) => weight > 3)
      .map(([id, weight]) => this.intoHumanReadable(parseInt(id), weight));
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

  toJSON() {
    return {
      nameTrieRoot: this.nameTrieRoot,
      keywordTrieRoot: this.keywordTrieRoot,
      categoryTrieRoot: this.categoryTrieRoot,
      nameMap: this.nameMap,
    };
  }
}
