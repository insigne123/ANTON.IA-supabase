// word-extractor ships no types: the part used to read Word 97-2003 (.doc) text.
declare module 'word-extractor' {
  class WordDocument { getBody(): string; getFootnotes(): string; getEndnotes(): string }
  export default class WordExtractor { extract(source: string | Buffer): Promise<WordDocument> }
}
