// Offline deterministic transliteration & proportional word-timing alignment
// Supports Japanese (Kana + common Kanji), Korean Hangul (Revised Romanization),
// Hindi/Devanagari, Cyrillic, Greek, Arabic, and Thai (RTGS).

import type { LyricWord } from '../lyricVisualizer/core/models';

export const NON_LATIN_SCRIPT_REGEX =
  /[\u0370-\u03FF\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\u0900-\u097F\u0E00-\u0E7F\u1100-\u11FF\u3040-\u30FF\u3130-\u318F\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFF65-\uFF9F]/;

export function hasNonLatinScript(text: string): boolean {
  if (!text || typeof text !== 'string') return false;
  return NON_LATIN_SCRIPT_REGEX.test(text);
}

// ---------------------------------------------------------------------------
// 1. Japanese: Hiragana / Katakana -> Hepburn Romaji + Common Kanji Readings
// ---------------------------------------------------------------------------

const KANA_DIGRAPHS: Readonly<Record<string, string>> = {
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  じゃ: 'ja',  じゅ: 'ju',  じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  ぢゃ: 'ja',  ぢゅ: 'ju',  ぢょ: 'jo',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  ふぁ: 'fa',  ふぃ: 'fi',  ふぇ: 'fe',  ふぉ: 'fo',
  てぃ: 'ti',  でぃ: 'di',  とぅ: 'tu',  どぅ: 'du',
  うぃ: 'wi',  うぇ: 'we',  うぉ: 'wo',
  ヴぁ: 'va',  ヴぃ: 'vi',  ヴぇ: 've',  ヴぉ: 'vo',
  しぇ: 'she', じぇ: 'je',  ちぇ: 'che',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
  くぁ: 'kwa', くぃ: 'kwi', くぇ: 'kwe', くぉ: 'kwo',
};

const KANA_MONOGRAPHS: Readonly<Record<string, string>> = {
  あ: 'a',  い: 'i',  う: 'u',  え: 'e',  お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'wo', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ぁ: 'a',  ぃ: 'i',  ぅ: 'u',  ぇ: 'e',  ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
  ヴ: 'vu', ゔ: 'vu', ヶ: 'ka', ヵ: 'ka',
};

// High-frequency lyric Kanji compounds and roots (longest-match first)
const KANJI_COMPOUNDS: Readonly<Record<string, string>> = {
  ありがとう: 'arigatou',
  さようなら: 'sayounara',
  大丈夫: 'daijoubu',
  真夜中: 'mayonaka',
  天の川: 'amanogawa',
  流れ星: 'nagareboshi',
  夕暮れ: 'yuugure',
  飛行機: 'hikouki',
  物語: 'monogatari',
  思い出: 'omoide',
  気持ち: 'kimochi',
  心の中: 'kokoro no naka',
  夢の中: 'yume no naka',
  東京: 'toukyou',
  日本: 'nihon',
  世界: 'sekai',
  未来: 'mirai',
  過去: 'kako',
  永遠: 'eien',
  瞬間: 'shunkan',
  記憶: 'kioku',
  約束: 'yakusoku',
  奇跡: 'kiseki',
  希望: 'kibou',
  笑顔: 'egao',
  言葉: 'kotoba',
  太陽: 'taiyou',
  星空: 'hoshizora',
  夜空: 'yozora',
  青空: 'aozora',
  朝日: 'asahi',
  夕日: 'yuuhi',
  運命: 'unmei',
  自由: 'jiyuu',
  孤独: 'kodoku',
  勇気: 'yuuki',
  天使: 'tenshi',
  悪魔: 'akuma',
  英雄: 'eiyuu',
  魔法: 'mahou',
  真実: 'shinjitsu',
  秘密: 'himitsu',
  青春: 'seishun',
  時間: 'jikan',
  時代: 'jidai',
  季節: 'kisetsu',
  写真: 'shashin',
  手紙: 'tegami',
  電話: 'denwa',
  電車: 'densha',
  天国: 'tengoku',
  地獄: 'jigoku',
  宇宙: 'uchuu',
  地球: 'chikyuu',
  今日: 'kyou',
  明日: 'ashita',
  昨日: 'kinou',
  毎日: 'mainichi',
  一人: 'hitori',
  二人: 'futari',
  貴方: 'anata',
  彼女: 'kanojo',
  彼氏: 'kareshi',
  友達: 'tomodachi',
  仲間: 'nakama',
  家族: 'kazoku',
  名前: 'namae',
  場所: 'basho',
  部屋: 'heya',
  世界中: 'sekaijuu',
  全部: 'zenbu',
  本当: 'hontou',
  好き: 'suki',
  嫌い: 'kirai',
  幸せ: 'shiawase',
  悲しい: 'kanashii',
  嬉しい: 'ureshii',
  優しい: 'yasashii',
  寂しい: 'sabishii',
  愛してる: 'aishiteru',
  光る: 'hikaru',
  輝く: 'kagayaku',
  落ちる: 'ochiru',
  見つけ: 'mitsuke',
};

const KANJI_SINGLE: Readonly<Record<string, string>> = {
  夢: 'yume', 愛: 'ai', 恋: 'koi', 心: 'kokoro', 空: 'sora',
  星: 'hoshi', 夜: 'yoru', 朝: 'asa', 昼: 'hiru', 夕: 'yuu',
  光: 'hikari', 影: 'kage', 涙: 'namida', 雨: 'ame', 風: 'kaze',
  花: 'hana', 海: 'umi', 月: 'tsuki', 日: 'hi', 時: 'toki',
  今: 'ima', 人: 'hito', 君: 'kimi', 僕: 'boku', 私: 'watashi',
  俺: 'ore', 手: 'te', 目: 'me', 瞳: 'hitomi', 耳: 'mimi',
  胸: 'mune', 翼: 'tsubasa', 道: 'michi', 街: 'machi', 扉: 'tobira',
  鍵: 'kagi', 春: 'haru', 夏: 'natsu', 秋: 'aki', 冬: 'fuyu',
  雪: 'yuki', 桜: 'sakura', 炎: 'honoo', 火: 'hi', 水: 'mizu',
  氷: 'koori', 雷: 'kaminari', 雲: 'kumo', 虹: 'niji', 闇: 'yami',
  色: 'iro', 白: 'shiro', 黒: 'kuro', 赤: 'aka', 青: 'ao',
  紅: 'kurenai', 金: 'kin', 銀: 'gin', 命: 'inochi', 魂: 'tamashii',
  声: 'koe', 歌: 'uta', 音: 'oto', 響: 'hibiki', 唄: 'uta',
  痛: 'ita', 強: 'tsuyo', 弱: 'yowa', 悲: 'kana', 嬉: 'ure',
  優: 'yasa', 寂: 'sabi', 好: 'su', 思: 'omo', 想: 'omo',
  忘: 'wasu', 覚: 'obo', 知: 'shi', 見: 'mi', 聞: 'ki',
  言: 'i', 話: 'hana', 歩: 'aru', 走: 'hashi', 飛: 'to',
  待: 'ma', 帰: 'kae', 行: 'i', 来: 'ku', 生: 'i',
  死: 'shi', 終: 'o', 始: 'haji', 続: 'tsuzu', 変: 'ka',
  信: 'shin', 願: 'nega', 祈: 'ino', 届: 'todo', 探: 'saga',
  守: 'mamo', 抱: 'da', 離: 'hana', 繋: 'tsuna', 消: 'ki',
  輝: 'kagaya', 燃: 'mo', 揺: 'yu', 流: 'naga', 降: 'fu',
  咲: 'sa', 散: 'chi', 落: 'o', 笑: 'wara', 泣: 'na',
  上: 'ue', 下: 'shita', 中: 'naka', 外: 'soto', 前: 'mae',
  後: 'ato', 隣: 'tonari', 遠: 'too', 近: 'chika', 新: 'atara',
  古: 'furu', 長: 'naga', 短: 'mijika', 大: 'oo', 小: 'chii',
  全: 'sube', 何: 'nani', 誰: 'dare', 神: 'kami', 嘘: 'uso',
  罪: 'tsumi', 罰: 'batsu', 幻: 'maboroshi', 名: 'na', 顔: 'kao',
  力: 'chikara', 傷: 'kizu', 跡: 'ato', 波: 'nami', 砂: 'suna',
  森: 'mori', 山: 'yama', 川: 'kawa', 橋: 'hashi', 窓: 'mado',
  鏡: 'kagami', 針: 'hari', 鐘: 'kane', 鎖: 'kusari',
  羽: 'hane', 羽根: 'hane', 城: 'shiro', 旅: 'tabi', 船: 'fune',
  車: 'kuruma', 駅: 'eki', 傘: 'kasa', 嘘つき: 'usotsuki',
  一: 'ichi', 二: 'ni', 三: 'san', 四: 'yon', 五: 'go',
  六: 'roku', 七: 'nana', 八: 'hachi', 九: 'kyuu', 十: 'juu',
  百: 'hyaku', 千: 'sen', 万: 'man', 零: 'zero',
};

const MAX_KANJI_COMPOUND_LEN = 5;

function katakanaToHiraganaChar(ch: string): string {
  const code = ch.charCodeAt(0);
  // Katakana U+30A1..U+30F6 -> Hiragana U+3041..U+3096
  if (code >= 0x30a1 && code <= 0x30f6) {
    return String.fromCharCode(code - 0x60);
  }
  return ch;
}

function isHiraganaCode(cp: number): boolean {
  return cp >= 0x3040 && cp <= 0x309f;
}

function isKatakanaCode(cp: number): boolean {
  return (cp >= 0x30a0 && cp <= 0x30ff) || (cp >= 0xff65 && cp <= 0xff9f);
}

function isKanjiCode(cp: number): boolean {
  return (
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    (cp >= 0xf900 && cp <= 0xfaff)
  );
}

const HALFWIDTH_KATAKANA_MAP: Readonly<Record<string, string>> = {
  ｱ: 'あ', ｲ: 'い', ｳ: 'う', ｴ: 'え', ｵ: 'お',
  ｶ: 'か', ｷ: 'き', ｸ: 'く', ｹ: 'け', ｺ: 'こ',
  ｻ: 'さ', ｼ: 'し', ｽ: 'す', ｾ: 'せ', ｿ: 'そ',
  ﾀ: 'た', ﾁ: 'ち', ﾂ: 'つ', ﾃ: 'て', ﾄ: 'と',
  ﾅ: 'な', ﾆ: 'に', ﾇ: 'ぬ', ﾈ: 'ね', ﾉ: 'の',
  ﾊ: 'は', ﾋ: 'ひ', ﾌ: 'ふ', ﾍ: 'へ', ﾎ: 'ほ',
  ﾏ: 'ま', ﾐ: 'み', ﾑ: 'む', ﾒ: 'め', ﾓ: 'も',
  ﾔ: 'や', ﾕ: 'ゆ', ﾖ: 'よ',
  ﾗ: 'ら', ﾘ: 'り', ﾙ: 'る', ﾚ: 'れ', ﾛ: 'ろ',
  ﾜ: 'わ', ｦ: 'を', ﾝ: 'ん',
  ｧ: 'ぁ', ｨ: 'ぃ', ｩ: 'ぅ', ｪ: 'ぇ', ｫ: 'ぉ',
  ｬ: 'ゃ', ｭ: 'ゅ', ｮ: 'ょ', ｯ: 'っ', ｰ: 'ー',
};

function normalizeJapaneseInput(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (HALFWIDTH_KATAKANA_MAP[ch]) {
      const next = input[i + 1];
      if (next === 'ﾞ' || next === 'ﾟ') {
        out += HALFWIDTH_KATAKANA_MAP[ch];
        i++;
        continue;
      }
      out += HALFWIDTH_KATAKANA_MAP[ch];
    } else if (ch === '\u3000') {
      out += ' ';
    } else if (ch === '、') {
      out += ', ';
    } else if (ch === '。') {
      out += '. ';
    } else if (ch === '！') {
      out += '!';
    } else if (ch === '？') {
      out += '?';
    } else {
      out += ch;
    }
  }
  return out;
}

function transliterateJapaneseSegment(raw: string): string {
  const text = normalizeJapaneseInput(raw);
  let out = '';
  let prevKind: 'none' | 'kanji' | 'hiragana' | 'katakana' | 'particle' | 'other' = 'none';
  let lastVowel = '';
  let i = 0;

  const appendSpaceIfNeeded = () => {
    if (out.length > 0 && !out.endsWith(' ') && !out.endsWith('(')) {
      out += ' ';
    }
  };

  while (i < text.length) {
    const ch = text[i];
    const cp = ch.codePointAt(0) ?? 0;

    // 1. Check multi-character Kanji / fixed compounds first
    let matchedCompound = '';
    const maxLen = Math.min(MAX_KANJI_COMPOUND_LEN, text.length - i);
    for (let len = maxLen; len >= 2; len--) {
      const slice = text.slice(i, i + len);
      if (KANJI_COMPOUNDS[slice]) {
        matchedCompound = slice;
        break;
      }
    }
    if (matchedCompound) {
      if (prevKind === 'hiragana' || prevKind === 'katakana' || prevKind === 'kanji') {
        appendSpaceIfNeeded();
      }
      const rom = KANJI_COMPOUNDS[matchedCompound];
      out += rom;
      lastVowel = /[aeiou]$/i.test(rom) ? rom[rom.length - 1] : '';
      prevKind = 'kanji';
      i += matchedCompound.length;
      continue;
    }

    // 2. Iteration mark 々 repeats previous kanji reading roughly or ignored gracefully
    if (ch === '々') {
      i++;
      continue;
    }

    // 3. Single Kanji
    if (isKanjiCode(cp)) {
      if (prevKind === 'hiragana' || prevKind === 'katakana' || prevKind === 'kanji') {
        appendSpaceIfNeeded();
      }
      const rom = KANJI_SINGLE[ch] ?? '';
      if (rom) {
        out += rom;
        lastVowel = /[aeiou]$/i.test(rom) ? rom[rom.length - 1] : '';
      } else {
        // Unknown Kanji fallback: preserve char or emit safe fallback token
        out += ch;
        lastVowel = '';
      }
      prevKind = 'kanji';
      i++;
      continue;
    }

    // 4. Kana (Hiragana or Katakana)
    const isKata = isKatakanaCode(cp);
    const isHira = isHiraganaCode(cp);
    if (isKata || isHira) {
      const hira = isKata ? katakanaToHiraganaChar(ch) : ch;

      // Choonpu ー lengthens preceding vowel
      if (ch === 'ー') {
        if (lastVowel) {
          out += lastVowel;
        }
        prevKind = isKata ? 'katakana' : 'hiragana';
        i++;
        continue;
      }

      // Sokuon っ / ッ doubles next consonant (t for ch...)
      if (hira === 'っ') {
        const nextRaw = text[i + 1] ?? '';
        const nextHira = katakanaToHiraganaChar(nextRaw);
        const nextPair = text[i + 2] ? nextHira + katakanaToHiraganaChar(text[i + 2]) : '';
        const nextRom = KANA_DIGRAPHS[nextPair] ?? KANA_MONOGRAPHS[nextHira] ?? '';
        if (nextRom.startsWith('ch')) {
          out += 't';
        } else if (nextRom && /^[bcdfghjklmnpqrstvwxyz]/i.test(nextRom)) {
          out += nextRom[0];
        }
        prevKind = isKata ? 'katakana' : 'hiragana';
        i++;
        continue;
      }

      // Syllabic nasal ん / ン
      if (hira === 'ん') {
        const nextRaw = text[i + 1] ?? '';
        const nextHira = katakanaToHiraganaChar(nextRaw);
        const nextRom = KANA_MONOGRAPHS[nextHira] ?? '';
        out += /^[aiueoy]/i.test(nextRom) ? "n'" : 'n';
        lastVowel = '';
        prevKind = isKata ? 'katakana' : 'hiragana';
        i++;
        continue;
      }

      // Check particle 'を' (always separates cleanly as ' wo ')
      if (!isKata && hira === 'を') {
        appendSpaceIfNeeded();
        out += 'wo';
        const nextCh = text[i + 1];
        if (nextCh && !/\s|[,.!?]/.test(nextCh)) {
          out += ' ';
        }
        lastVowel = 'o';
        prevKind = 'particle';
        i++;
        continue;
      }

      // Check particle 'は' or 'へ' or 'の' or 'が' or 'に' or 'で' or 'と' or 'も' when directly after Kanji/Katakana and followed by Kanji/Katakana
      if (
        !isKata &&
        (prevKind === 'kanji' || prevKind === 'katakana') &&
        (hira === 'は' || hira === 'の' || hira === 'が' || hira === 'に' || hira === 'で' || hira === 'へ')
      ) {
        const nextCh = text[i + 1] ?? '';
        const nextCp = nextCh.codePointAt(0) ?? 0;
        const nextIsWordStart = !nextCh || /\s/.test(nextCh) || isKanjiCode(nextCp) || isKatakanaCode(nextCp);
        if (nextIsWordStart) {
          appendSpaceIfNeeded();
          const pRom = hira === 'は' ? 'wa' : hira === 'へ' ? 'e' : KANA_MONOGRAPHS[hira];
          out += pRom;
          if (nextCh && !/\s|[,.!?]/.test(nextCh)) {
            out += ' ';
          }
          lastVowel = pRom[pRom.length - 1];
          prevKind = 'particle';
          i++;
          continue;
        }
      }

      // Word boundary between Hiragana <-> Katakana
      if (
        (isKata && prevKind === 'hiragana') ||
        (!isKata && prevKind === 'katakana')
      ) {
        appendSpaceIfNeeded();
      }

      // Digraph lookup
      const nextRaw = text[i + 1] ?? '';
      const nextHira = katakanaToHiraganaChar(nextRaw);
      const pair = hira + nextHira;
      if (KANA_DIGRAPHS[pair]) {
        const rom = KANA_DIGRAPHS[pair];
        out += rom;
        lastVowel = /[aeiou]$/i.test(rom) ? rom[rom.length - 1] : '';
        prevKind = isKata ? 'katakana' : 'hiragana';
        i += 2;
        continue;
      }

      const mono = KANA_MONOGRAPHS[hira];
      if (mono !== undefined) {
        out += mono;
        lastVowel = /[aeiou]$/i.test(mono) ? mono[mono.length - 1] : '';
        prevKind = isKata ? 'katakana' : 'hiragana';
        i++;
        continue;
      }
    }

    out += ch;
    lastVowel = '';
    prevKind = /\s/.test(ch) ? 'none' : 'other';
    i++;
  }

  return out.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// 2. Korean Hangul -> Algorithmic Revised Romanization
// ---------------------------------------------------------------------------

const HANGUL_INITIALS = [
  'g', 'kk', 'n', 'd', 'tt', 'r', 'm', 'b', 'pp',
  's', 'ss', '', 'j', 'jj', 'ch', 'k', 't', 'p', 'h',
] as const;

const HANGUL_MEDIALS = [
  'a', 'ae', 'ya', 'yae', 'eo', 'e', 'yeo', 'ye', 'o',
  'wa', 'wae', 'oe', 'yo', 'u', 'wo', 'we', 'wi', 'yu',
  'eu', 'ui', 'i',
] as const;

const HANGUL_FINALS = [
  '', 'k', 'k', 'k', 'n', 'n', 'n', 't', 'l', 'k',
  'm', 'l', 'l', 'l', 'p', 'l', 'm', 'p', 'p', 't',
  't', 'ng', 't', 't', 'k', 't', 'p', 't',
] as const;

const COMPAT_JAMO_MAP: Readonly<Record<string, string>> = {
  ㄱ: 'g', ㄲ: 'kk', ㄴ: 'n', ㄷ: 'd', ㄸ: 'tt', ㄹ: 'r', ㅁ: 'm',
  ㅂ: 'b', ㅃ: 'pp', ㅅ: 's', ㅆ: 'ss', ㅇ: '', ㅈ: 'j', ㅉ: 'jj',
  ㅊ: 'ch', ㅋ: 'k', ㅌ: 't', ㅍ: 'p', ㅎ: 'h',
  ㅏ: 'a', ㅐ: 'ae', ㅑ: 'ya', ㅒ: 'yae', ㅓ: 'eo', ㅔ: 'e',
  ㅕ: 'yeo', ㅖ: 'ye', ㅗ: 'o', ㅘ: 'wa', ㅙ: 'wae', ㅚ: 'oe',
  ㅛ: 'yo', ㅜ: 'u', ㅝ: 'wo', ㅞ: 'we', ㅟ: 'wi', ㅠ: 'yu',
  ㅡ: 'eu', ㅢ: 'ui', ㅣ: 'i',
};

function isHangulSyllable(cp: number): boolean {
  return cp >= 0xac00 && cp <= 0xd7a3;
}

function transliterateHangulSegment(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const cp = ch.charCodeAt(0);
    if (isHangulSyllable(cp)) {
      const sIndex = cp - 0xac00;
      const ini = Math.floor(sIndex / 588);
      const med = Math.floor((sIndex % 588) / 28);
      const fin = sIndex % 28;

      const nextCp = i + 1 < text.length ? text.charCodeAt(i + 1) : 0;
      const nextIsHangul = isHangulSyllable(nextCp);
      const nextIni = nextIsHangul ? Math.floor((nextCp - 0xac00) / 588) : -1;

      // Override initial if previous syllable already liaised into this syllable
      let iniRom: string = HANGUL_INITIALS[ini];
      if (i > 0 && isHangulSyllable(text.charCodeAt(i - 1))) {
        const prevFin = (text.charCodeAt(i - 1) - 0xac00) % 28;
        if (ini === 11 && prevFin > 0) {
          // Liaison from previous final onto silent ㅇ
          if (prevFin === 1 || prevFin === 24) iniRom = 'g';
          else if (prevFin === 7 || prevFin === 25) iniRom = 'd';
          else if (prevFin === 17 || prevFin === 26) iniRom = 'b';
          else if (prevFin === 8) iniRom = 'r';
          else if (prevFin === 4) iniRom = 'n';
          else if (prevFin === 16) iniRom = 'm';
          else if (prevFin === 19) iniRom = 's';
          else if (prevFin === 20) iniRom = 'ss';
          else if (prevFin === 22) iniRom = 'j';
          else if (prevFin === 23) iniRom = 'ch';
        } else if (prevFin === 8 && ini === 5) {
          // ㄹ + ㄹ -> l + l
          iniRom = 'l';
        } else if (prevFin === 4 && ini === 5) {
          // ㄴ + ㄹ -> l + l
          iniRom = 'l';
        }
      }

      let finRom: string = HANGUL_FINALS[fin];
      if (fin > 0 && nextIsHangul) {
        if (nextIni === 11) {
          // Coda moves to next syllable onset (except ㅇ/ng and double finals)
          if (fin === 1 || fin === 7 || fin === 8 || fin === 17 || fin === 19 || fin === 20 || fin === 22 || fin === 23 || fin === 24 || fin === 25 || fin === 26) {
            finRom = '';
          } else if (fin === 4 || fin === 16) {
            finRom = '';
          } else if (fin === 27) {
            finRom = '';
          }
        } else if (fin === 4 && nextIni === 5) {
          finRom = 'l';
        } else if (fin === 8 && nextIni === 2) {
          finRom = 'l';
        } else if (fin === 1 && (nextIni === 2 || nextIni === 6)) {
          finRom = 'ng';
        } else if (fin === 17 && (nextIni === 2 || nextIni === 6)) {
          finRom = 'm';
        }
      }

      out += iniRom + HANGUL_MEDIALS[med] + finRom;
    } else if (COMPAT_JAMO_MAP[ch] !== undefined) {
      out += COMPAT_JAMO_MAP[ch];
    } else {
      out += ch;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 3. Hindi / Devanagari -> Phonetic Latin
// ---------------------------------------------------------------------------

const DEVA_INDEP_VOWELS: Readonly<Record<string, string>> = {
  अ: 'a', आ: 'aa', इ: 'i', ई: 'ee', उ: 'u', ऊ: 'oo',
  ऋ: 'ri', ए: 'e', ऐ: 'ai', ओ: 'o', औ: 'au', अं: 'am', अः: 'ah',
  ऑ: 'o',
};

const DEVA_CONSONANTS: Readonly<Record<string, string>> = {
  क: 'k',  ख: 'kh', ग: 'g',  घ: 'gh', ङ: 'ng',
  च: 'ch', छ: 'chh', ज: 'j',  झ: 'jh', ञ: 'ny',
  ट: 't',  ठ: 'th', ड: 'd',  ढ: 'dh', ण: 'n',
  त: 't',  थ: 'th', द: 'd',  ध: 'dh', न: 'n',
  प: 'p',  फ: 'ph', ब: 'b',  भ: 'bh', म: 'm',
  य: 'y',  र: 'r',  ल: 'l',  व: 'v',  श: 'sh',
  ष: 'sh', स: 's',  ह: 'h',  ळ: 'l',
  क़: 'q', ख़: 'kh', ग़: 'gh', ज़: 'z', ड़: 'r', ढ़: 'rh', फ़: 'f', य़: 'y',
  क्ष: 'ksh', त्र: 'tr', ज्ञ: 'gya',
};

const DEVA_MATRAS: Readonly<Record<string, string>> = {
  '\u093E': 'aa', '\u093F': 'i',  '\u0940': 'ee', '\u0941': 'u',  '\u0942': 'oo',
  '\u0943': 'ri', '\u0947': 'e',  '\u0948': 'ai', '\u094B': 'o',  '\u094C': 'au',
  '\u0945': 'e',  '\u0949': 'o',
};

const DEVA_DIGITS: Readonly<Record<string, string>> = {
  '०': '0', '१': '1', '२': '2', '३': '3', '४': '4',
  '५': '5', '६': '6', '७': '7', '८': '8', '९': '9',
};

function isDevaChar(ch: string): boolean {
  const cp = ch.charCodeAt(0);
  return cp >= 0x0900 && cp <= 0x097f;
}

function transliterateDevanagariWord(word: string): string {
  let out = '';
  let consCount = 0;
  let i = 0;

  while (i < word.length) {
    // Check 3-char conjuncts like क्ष, त्र, ज्ञ
    const tri = word.slice(i, i + 3);
    let baseCons = '';
    let step = 1;
    if (DEVA_CONSONANTS[tri]) {
      baseCons = DEVA_CONSONANTS[tri];
      step = 3;
    } else if (i + 1 < word.length && word[i + 1] === '\u093C' && DEVA_CONSONANTS[word.slice(i, i + 2)]) {
      baseCons = DEVA_CONSONANTS[word.slice(i, i + 2)];
      step = 2;
    } else if (DEVA_CONSONANTS[word[i]]) {
      baseCons = DEVA_CONSONANTS[word[i]];
      step = 1;
    }

    if (baseCons) {
      consCount++;
      out += baseCons;
      i += step;

      // Consume optional nukta if not already consumed
      if (word[i] === '\u093C') i++;

      const next = word[i];
      if (next === '\u094D') {
        // Virama suppresses inherent vowel
        i++;
      } else if (next && DEVA_MATRAS[next]) {
        const matra = DEVA_MATRAS[next];
        const isWordEnd = i + 1 >= word.length || (i + 2 === word.length && (word[i + 1] === '\u0902' || word[i + 1] === '\u0901'));
        out += matra === 'aa' && isWordEnd ? 'aa' : matra;
        i++;
      } else {
        // Inherent schwa 'a': drop at end of polysyllabic words (e.g., दिल -> dil, प्यार -> pyar)
        const atWordEnd = i >= word.length || ((word[i] === '\u0902' || word[i] === '\u0901') && i + 1 >= word.length);
        if (!atWordEnd || consCount <= 1) {
          out += 'a';
        }
      }
      continue;
    }

    const ch = word[i];
    if (DEVA_INDEP_VOWELS[ch]) {
      out += DEVA_INDEP_VOWELS[ch];
    } else if (ch === '\u0902' || ch === '\u0901') {
      const nextCh = word[i + 1] ?? '';
      out += nextCh === 'प' || nextCh === 'ब' || nextCh === 'म' ? 'm' : 'n';
    } else if (ch === '\u0903') {
      out += 'h';
    } else if (DEVA_DIGITS[ch]) {
      out += DEVA_DIGITS[ch];
    } else if (ch === '।' || ch === '॥') {
      out += '.';
    } else if (ch !== '\u093C' && ch !== '\u094D') {
      out += ch;
    }
    i++;
  }

  return out;
}

function transliterateDevanagariSegment(text: string): string {
  return text.replace(/[\u0900-\u097F]+/g, (word) => transliterateDevanagariWord(word));
}

// ---------------------------------------------------------------------------
// 4. Cyrillic -> Latin
// ---------------------------------------------------------------------------

const CYRILLIC_MAP: Readonly<Record<string, string>> = {
  а: 'a',  б: 'b',  в: 'v',  г: 'g',  д: 'd',  е: 'e',  ё: 'yo',
  ж: 'zh', з: 'z',  и: 'i',  й: 'y',  к: 'k',  л: 'l',  м: 'm',
  н: 'n',  о: 'o',  п: 'p',  р: 'r',  с: 's',  т: 't',  у: 'u',
  ф: 'f',  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '',
  ы: 'y',  ь: '',   э: 'e',  ю: 'yu', я: 'ya',
  є: 'ye', і: 'i',  ї: 'yi', ґ: 'g',  ў: 'u',
  ђ: 'dj', ј: 'j',  љ: 'lj', њ: 'nj', ћ: 'c',  џ: 'dz',
};

function applyCase(lat: string, originalChar: string, nextChar?: string): string {
  if (!lat) return lat;
  const isUpper = originalChar !== originalChar.toLowerCase();
  if (!isUpper) return lat;
  const nextIsUpper = nextChar ? nextChar !== nextChar.toLowerCase() && nextChar === nextChar.toUpperCase() : false;
  return nextIsUpper ? lat.toUpperCase() : lat[0].toUpperCase() + lat.slice(1);
}

function transliterateCyrillicSegment(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const lower = ch.toLowerCase();
    if (CYRILLIC_MAP[lower] !== undefined) {
      let mapped = CYRILLIC_MAP[lower];
      if (lower === 'е') {
        const prev = i > 0 ? text[i - 1].toLowerCase() : '';
        if (i === 0 || /[\s.,!?;:()аеёиоуыэюяьъ]/.test(prev)) {
          mapped = 'ye';
        }
      }
      out += applyCase(mapped, ch, text[i + 1]);
    } else {
      out += ch;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 5. Greek -> Latin
// ---------------------------------------------------------------------------

const GREEK_DIGRAPHS: Readonly<Record<string, string>> = {
  αι: 'ai', ει: 'ei', οι: 'oi', υι: 'yi', ου: 'ou',
  αυ: 'av', ευ: 'ev', ηυ: 'iv', γγ: 'ng', γκ: 'g',
  γχ: 'nch', γξ: 'nx', τσ: 'ts', τζ: 'tz',
};

const GREEK_SINGLE: Readonly<Record<string, string>> = {
  α: 'a', β: 'v', γ: 'g', δ: 'd', ε: 'e', ζ: 'z',
  η: 'i', θ: 'th', ι: 'i', κ: 'k', λ: 'l', μ: 'm',
  ν: 'n', ξ: 'x', ο: 'o', π: 'p', ρ: 'r', σ: 's',
  ς: 's', τ: 't', υ: 'y', φ: 'f', χ: 'ch', ψ: 'ps',
  ω: 'o',
};

function transliterateGreekSegment(text: string): string {
  const cleaned = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  let out = '';
  let i = 0;
  while (i < cleaned.length) {
    const ch = cleaned[i];
    const lower = ch.toLowerCase();
    const next = cleaned[i + 1] ?? '';
    const pair = lower + next.toLowerCase();

    if (pair === 'μπ') {
      const prev = cleaned[i - 1] ?? '';
      const isInitial = i === 0 || /[\s.,!?;:()]/.test(prev);
      out += applyCase(isInitial ? 'b' : 'mp', ch, cleaned[i + 2]);
      i += 2;
      continue;
    }
    if (pair === 'ντ') {
      const prev = cleaned[i - 1] ?? '';
      const isInitial = i === 0 || /[\s.,!?;:()]/.test(prev);
      out += applyCase(isInitial ? 'd' : 'nt', ch, cleaned[i + 2]);
      i += 2;
      continue;
    }
    if (GREEK_DIGRAPHS[pair]) {
      out += applyCase(GREEK_DIGRAPHS[pair], ch, cleaned[i + 2]);
      i += 2;
      continue;
    }
    if (GREEK_SINGLE[lower]) {
      out += applyCase(GREEK_SINGLE[lower], ch, next);
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// 6. Arabic -> Phonetic Latin
// ---------------------------------------------------------------------------

const ARABIC_LETTERS: Readonly<Record<string, string>> = {
  ا: 'a',  أ: 'a',  إ: 'i',  آ: 'aa', ٱ: 'a',
  ب: 'b',  ت: 't',  ث: 'th', ج: 'j',  ح: 'h',
  خ: 'kh', د: 'd',  ذ: 'dh', ر: 'r',  ز: 'z',
  س: 's',  ش: 'sh', ص: 's',  ض: 'd',  ط: 't',
  ظ: 'z',  ع: 'a',  غ: 'gh', ف: 'f',  ق: 'q',
  ك: 'k',  ل: 'l',  م: 'm',  ن: 'n',  ه: 'h',
  ة: 'a',  و: 'w',  ي: 'y',  ى: 'a',  ئ: 'y',
  ؤ: 'w',  ء: '',   پ: 'p',  چ: 'ch', ژ: 'zh',
  گ: 'g',  ک: 'k',  ی: 'y',
};

const ARABIC_DIACRITICS: Readonly<Record<string, string>> = {
  '\u064E': 'a', '\u064F': 'u', '\u0650': 'i',
  '\u064B': 'an', '\u064C': 'un', '\u064D': 'in',
  '\u0652': '', '\u0670': 'a',
};

function transliterateArabicSegment(text: string): string {
  let out = '';
  let lastConsonant = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '،') {
      out += ',';
      lastConsonant = '';
      continue;
    }
    if (ch === '؟') {
      out += '?';
      lastConsonant = '';
      continue;
    }
    if (ch === '\u0651') {
      if (lastConsonant) out += lastConsonant;
      continue;
    }
    if (ARABIC_DIACRITICS[ch] !== undefined) {
      out += ARABIC_DIACRITICS[ch];
      continue;
    }
    if (ch === 'ا' && text[i + 1] === 'ل' && (i === 0 || /\s/.test(text[i - 1]))) {
      out += 'al-';
      i++;
      lastConsonant = 'l';
      continue;
    }
    const mapped = ARABIC_LETTERS[ch];
    if (mapped !== undefined) {
      if (ch === 'و' && out.length > 0 && !/[aeiou]$/i.test(out)) {
        out += text[i + 1] && ARABIC_DIACRITICS[text[i + 1]] ? 'w' : 'oo';
      } else if (ch === 'ي' && out.length > 0 && !/[aeiou]$/i.test(out)) {
        out += text[i + 1] && ARABIC_DIACRITICS[text[i + 1]] ? 'y' : 'ee';
      } else {
        out += mapped;
      }
      lastConsonant = mapped;
    } else {
      out += ch;
      lastConsonant = '';
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 7. Thai -> RTGS (Royal Thai General System of Transcription)
// ---------------------------------------------------------------------------

const THAI_INITIALS: Readonly<Record<string, string>> = {
  ก: 'k',  ข: 'kh', ฃ: 'kh', ค: 'kh', ฅ: 'kh', ฆ: 'kh',
  ง: 'ng', จ: 'ch', ฉ: 'ch', ช: 'ch', ซ: 's',  ฌ: 'ch',
  ญ: 'y',  ฎ: 'd',  ฏ: 't',  ฐ: 'th', ฑ: 'th', ฒ: 'th',
  ณ: 'n',  ด: 'd',  ต: 't',  ถ: 'th', ท: 'th', ธ: 'th',
  น: 'n',  บ: 'b',  ป: 'p',  ผ: 'ph', ฝ: 'f',  พ: 'ph',
  ฟ: 'f',  ภ: 'ph', ม: 'm',  ย: 'y',  ร: 'r',  ล: 'l',
  ว: 'w',  ศ: 's',  ษ: 's',  ส: 's',  ห: 'h',  ฬ: 'l',
  อ: '',   ฮ: 'h',
};

const THAI_FINALS: Readonly<Record<string, string>> = {
  ก: 'k', ข: 'k', ค: 'k', ฆ: 'k',
  ง: 'ng',
  จ: 't', ช: 't', ซ: 't', ฎ: 't', ฏ: 't', ฐ: 't', ฑ: 't', ฒ: 't', ด: 't', ต: 't', ถ: 't', ท: 't', ธ: 't', ศ: 't', ษ: 't', ส: 't',
  ญ: 'n', ณ: 'n', น: 'n', ร: 'n', ล: 'n', ฬ: 'n',
  บ: 'p', ป: 'p', พ: 'p', ฟ: 'p', ภ: 'p',
  ม: 'm',
  ย: 'i',
  ว: 'o',
};

const THAI_LEADING_VOWELS: Readonly<Record<string, string>> = {
  เ: 'e', แ: 'ae', โ: 'o', ไ: 'ai', ใ: 'ai',
};

const THAI_POST_VOWELS: Readonly<Record<string, string>> = {
  'ะ': 'a', 'า': 'a', '\u0E34': 'i', '\u0E35': 'i', '\u0E36': 'ue', '\u0E37': 'ue',
  '\u0E38': 'u', '\u0E39': 'u', '\u0E31': 'a', 'ำ': 'am', '\u0E47': '', 'ๅ': 'ue',
};

function isThaiConsonant(ch: string): boolean {
  return THAI_INITIALS[ch] !== undefined;
}

function isThaiToneOrSilent(ch: string): boolean {
  const cp = ch.charCodeAt(0);
  return (cp >= 0x0e48 && cp <= 0x0e4c) || ch === '\u0E47';
}

function transliterateThaiSegment(raw: string): string {
  // Remove cancelled character before thanthakhat (์) and strip tone marks
  let cleaned = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i + 1] === '\u0E4C') {
      i++;
      continue;
    }
    if (!isThaiToneOrSilent(raw[i])) {
      cleaned += raw[i];
    }
  }

  const syllables: string[] = [];
  let i = 0;

  while (i < cleaned.length) {
    const ch = cleaned[i];
    const leadV = THAI_LEADING_VOWELS[ch];

    if (leadV || isThaiConsonant(ch)) {
      let vowelBefore = '';
      if (leadV) {
        vowelBefore = leadV;
        i++;
      }

      if (i >= cleaned.length || !isThaiConsonant(cleaned[i])) {
        if (vowelBefore) syllables.push(vowelBefore);
        continue;
      }

      const iniCh = cleaned[i];
      let ini = THAI_INITIALS[iniCh] ?? '';
      i++;

      // Consonant cluster (ทร -> s, or ร/ล/ว second consonant)
      const validRLCluster = 'กขคตปผพภ'.includes(iniCh);
      const validWCluster = 'กขค'.includes(iniCh);
      if (
        iniCh === 'ท' &&
        cleaned[i] === 'ร' &&
        (cleaned[i + 1] && (THAI_POST_VOWELS[cleaned[i + 1]] || isThaiConsonant(cleaned[i + 1])))
      ) {
        ini = 's';
        i++;
      } else if (
        cleaned[i] &&
        (((cleaned[i] === 'ร' || cleaned[i] === 'ล') && validRLCluster) ||
          (cleaned[i] === 'ว' && validWCluster)) &&
        cleaned[i + 1] &&
        (THAI_POST_VOWELS[cleaned[i + 1]] !== undefined || (vowelBefore && isThaiConsonant(cleaned[i + 1])))
      ) {
        ini += THAI_INITIALS[cleaned[i]];
        i++;
      }

      let vowel = vowelBefore;
      let postVowel = '';
      while (i < cleaned.length && THAI_POST_VOWELS[cleaned[i]] !== undefined) {
        postVowel += cleaned[i];
        i++;
      }

      // Combine leading + post vowels per RTGS
      if (vowelBefore === 'e') {
        if (postVowel.includes('ี') && cleaned[i] === 'ย') {
          vowel = 'ia';
          i++;
        } else if (postVowel.includes('ื') && cleaned[i] === 'อ') {
          vowel = 'uea';
          i++;
        } else if (postVowel === 'า' || postVowel === 'าะ') {
          vowel = postVowel === 'าะ' ? 'o' : 'ao';
        } else if (cleaned[i] === 'อ') {
          vowel = 'oe';
          i++;
        } else if (postVowel) {
          vowel = 'e' + (THAI_POST_VOWELS[postVowel[0]] ?? '');
        }
      } else if (postVowel) {
        if (postVowel === 'ั' && cleaned[i] === 'ว') {
          vowel = 'ua';
          i++;
        } else {
          vowel = '';
          for (const pv of postVowel) {
            vowel += THAI_POST_VOWELS[pv] ?? '';
          }
        }
      }

      // Check final consonant if followed by non-vowel or end
      let fin = '';
      if (
        i < cleaned.length &&
        THAI_FINALS[cleaned[i]] !== undefined &&
        !(cleaned[i + 1] && THAI_POST_VOWELS[cleaned[i + 1]] !== undefined) &&
        !THAI_LEADING_VOWELS[cleaned[i]]
      ) {
        // Avoid consuming initial consonant of next syllable if this syllable already has an open vowel unless end/non-Thai
        if (i + 1 >= cleaned.length || !isThaiConsonant(cleaned[i + 1]) || !postVowel || postVowel === 'ั') {
          if (cleaned[i] === 'ว' && !vowelBefore && postVowel === '') {
            vowel = 'ua';
          } else {
            fin = THAI_FINALS[cleaned[i]];
          }
          i++;
        }
      }

      if (!vowel) {
        vowel = iniCh === 'อ' ? 'o' : fin ? 'o' : 'a';
      }

      syllables.push((ini || (iniCh === 'อ' && !vowel ? 'o' : '')) + vowel + fin);
      continue;
    }

    if (/\s/.test(ch)) {
      if (syllables.length > 0 && !syllables[syllables.length - 1].endsWith(' ')) {
        syllables.push(' ');
      }
      i++;
      continue;
    }

    syllables.push(ch);
    i++;
  }

  return syllables
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Public API: transliterateToLatin & mapRomanizedWords
// ---------------------------------------------------------------------------

export function transliterateToLatin(text: string): string {
  if (!text || typeof text !== 'string') return '';
  if (!hasNonLatinScript(text)) return text;

  let result = text;

  // Japanese (Kana / Kanji)
  if (/[\u3040-\u30FF\u31F0-\u31FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uFF65-\uFF9F]/.test(result)) {
    result = transliterateJapaneseSegment(result);
  }
  // Korean Hangul
  if (/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/.test(result)) {
    result = transliterateHangulSegment(result);
  }
  // Hindi / Devanagari
  if (/[\u0900-\u097F]/.test(result)) {
    result = transliterateDevanagariSegment(result);
  }
  // Cyrillic
  if (/[\u0400-\u04FF]/.test(result)) {
    result = transliterateCyrillicSegment(result);
  }
  // Greek
  if (/[\u0370-\u03FF]/.test(result)) {
    result = transliterateGreekSegment(result);
  }
  // Arabic / Persian / Urdu
  if (/[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF]/.test(result)) {
    result = transliterateArabicSegment(result);
  }
  // Thai
  if (/[\u0E00-\u0E7F]/.test(result)) {
    result = transliterateThaiSegment(result);
  }

  return result.replace(/\s+/g, ' ').trim();
}

function estimateTokenWeight(tok: string): number {
  const clean = tok.trim();
  if (!clean) return 0.5;
  const vowels = clean.match(/[aeiouy]+/gi);
  const syllables = vowels ? vowels.length : 1;
  return Math.max(0.5, syllables * 0.7 + clean.length * 0.15);
}

/**
 * Maps timing intervals from original `words` onto whitespace-separated tokens of `romanizedText`,
 * preserving exact `[lineStart, lineEnd]` bounds and proportional per-word timing across uneven spans.
 */
export function mapRomanizedWords(
  words: readonly LyricWord[],
  romanizedText: string,
  lineStart: number,
  lineEnd: number
): LyricWord[] {
  const tokens = (romanizedText || '')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return [];

  const safeLineStart = Number.isFinite(lineStart) ? Math.max(0, lineStart) : 0;
  const safeLineEnd = Math.max(safeLineStart + 0.05, Number.isFinite(lineEnd) ? lineEnd : safeLineStart + 1);

  // Exact 1-to-1 match preserves original word timings verbatim
  if (words.length === tokens.length) {
    return tokens.map((tok, i) => {
      const wStart = Math.max(safeLineStart, words[i].startSeconds);
      const wEnd = Math.max(wStart + 0.01, Math.min(safeLineEnd, words[i].endSeconds));
      return {
        text: tok,
        startSeconds: wStart,
        endSeconds: wEnd,
      };
    });
  }

  // Build piecewise-linear timeline over original words (or fallback uniform line span)
  const timelineStart = words.length > 0 ? Math.max(safeLineStart, words[0].startSeconds) : safeLineStart;
  const timelineEnd =
    words.length > 0
      ? Math.max(timelineStart + 0.05, Math.min(safeLineEnd, words[words.length - 1].endSeconds))
      : safeLineEnd;

  const knotsU: number[] = [0];
  const knotsT: number[] = [timelineStart];

  if (words.length > 0) {
    const wordWeights = words.map((w) => Math.max(1, w.text.trim().length));
    const totalW = wordWeights.reduce((a, b) => a + b, 0) || words.length;
    let cumW = 0;
    for (let i = 0; i < words.length; i++) {
      cumW += wordWeights[i];
      knotsU.push(cumW / totalW);
      const t = i === words.length - 1 ? timelineEnd : Math.max(knotsT[knotsT.length - 1], Math.min(timelineEnd, words[i].endSeconds));
      knotsT.push(t);
    }
  } else {
    knotsU.push(1);
    knotsT.push(timelineEnd);
  }

  const sampleTimeAt = (u: number): number => {
    if (u <= 0) return knotsT[0];
    if (u >= 1) return knotsT[knotsT.length - 1];
    for (let k = 1; k < knotsU.length; k++) {
      if (u <= knotsU[k]) {
        const u0 = knotsU[k - 1];
        const u1 = knotsU[k];
        const frac = u1 > u0 ? (u - u0) / (u1 - u0) : 0;
        return knotsT[k - 1] + frac * (knotsT[k] - knotsT[k - 1]);
      }
    }
    return knotsT[knotsT.length - 1];
  };

  const romWeights = tokens.map(estimateTokenWeight);
  const totalRomWeight = romWeights.reduce((a, b) => a + b, 0) || tokens.length;

  const out: LyricWord[] = new Array(tokens.length);
  let cumRom = 0;
  let prevEnd = timelineStart;

  for (let i = 0; i < tokens.length; i++) {
    const startU = cumRom / totalRomWeight;
    cumRom += romWeights[i];
    const endU = i === tokens.length - 1 ? 1 : cumRom / totalRomWeight;

    const rawStart = i === 0 ? timelineStart : prevEnd;
    const rawEnd = i === tokens.length - 1 ? timelineEnd : Math.max(rawStart + 0.001, sampleTimeAt(endU));
    const clampedEnd = Math.min(timelineEnd, Math.max(rawStart + 0.001, rawEnd));

    out[i] = {
      text: tokens[i],
      startSeconds: rawStart,
      endSeconds: clampedEnd,
    };
    prevEnd = clampedEnd;
  }

  return out;
}
