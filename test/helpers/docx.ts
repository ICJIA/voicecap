/**
 * Reading a .docx in a test: its parts as XML, and what a reader gets from the body of the
 * document. The XML is read in order, so the paragraphs, the runs, and the line breaks come out as
 * the file has them. Two builds of one document differ in bytes (the links' ids are random, and the
 * file keeps when it was made), so a test reads the XML and never compares the bytes.
 */
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";

/** The parts of a .docx a test reads, each as its XML, and its pictures as their bytes. */
export interface DocxParts {
  document: string;
  styles: string;
  /** The document's properties: its title, its author, and its description. */
  core: string;
  footer: string;
  /** The document's relationships: where each of its links and pictures goes. */
  rels: string;
  /**
   * Each file in the document's `word/media/` folder, by its name there (a hash of its bytes and
   * its type: "4766f90bf6aec4c64b9fb249cceb00da9321fffb.jpg").
   */
  media: Map<string, Uint8Array>;
}

/** The parts of a .docx a test reads. Throws for a part the file doesn't have. */
export async function unzipDocx(bytes: Uint8Array): Promise<DocxParts> {
  const zip = await JSZip.loadAsync(bytes);
  const read = async (name: string): Promise<string> => {
    const file = zip.file(name);
    if (file === null) throw new Error(`No ${name} in the .docx`);
    return file.async("string");
  };
  const footerName = Object.keys(zip.files).find((name) => /^word\/footer\d*\.xml$/.test(name));
  const media = new Map<string, Uint8Array>();
  for (const name of Object.keys(zip.files)) {
    const file = name.startsWith("word/media/") ? zip.file(name) : null;
    if (file !== null) media.set(name.slice("word/media/".length), await file.async("uint8array"));
  }
  return {
    document: await read("word/document.xml"),
    styles: await read("word/styles.xml"),
    core: await read("docProps/core.xml"),
    footer: await read(footerName ?? "word/footer1.xml"),
    rels: await read("word/_rels/document.xml.rels"),
    media,
  };
}

/** An element of the XML, or a run of text (the tag "#text"), its children in the file's order. */
interface XmlElement {
  tag: string;
  attributes: Record<string, string>;
  children: XmlElement[];
  /** What a run of text says; nothing for an element. */
  text: string;
}

// Text is kept as it is (the spaces around a run's words count) and never turned into a number.
const parser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: "",
  trimValues: false,
  parseTagValue: false,
});

function elementsOf(parsed: unknown): XmlElement[] {
  return (parsed as Record<string, unknown>[]).map((node) => {
    const { ":@": attributes, ...tagged } = node;
    const [tag = "#text"] = Object.keys(tagged);
    const content = tagged[tag];
    return {
      tag,
      attributes: (attributes ?? {}) as Record<string, string>,
      children: Array.isArray(content) ? elementsOf(content) : [],
      text: typeof content === "string" ? content : "",
    };
  });
}

function parse(xml: string): XmlElement[] {
  return elementsOf(parser.parse(xml));
}

function childrenOf(element: XmlElement | undefined, tag: string): XmlElement[] {
  return element?.children.filter((child) => child.tag === tag) ?? [];
}

/** Each element of a tag anywhere under some elements, in the file's order. */
function descendants(elements: XmlElement[], tag: string): XmlElement[] {
  return elements.flatMap((element) => [
    ...(element.tag === tag ? [element] : []),
    ...descendants(element.children, tag),
  ]);
}

function bodyOf(documentXml: string): XmlElement[] {
  const [document] = parse(documentXml).filter((element) => element.tag === "w:document");
  const [body] = childrenOf(document, "w:body");
  if (body === undefined) throw new Error("No w:body in the document");
  return body.children;
}

/** The words under an element. Only a `w:t` says any; a break is "\n" and a tab is "\t". */
function textOf(element: XmlElement): string {
  switch (element.tag) {
    case "w:t":
      // A newline in a run's text is no line break in Word, which shows it as a space.
      return element.children.map((child) => child.text.replace(/[\r\n]/g, " ")).join("");
    case "w:br":
      // A page or a column break isn't a line break.
      return (element.attributes["w:type"] ?? "textWrapping") === "textWrapping" ? "\n" : "";
    case "w:tab":
      return "\t";
    case "w:pPr":
    case "w:rPr":
      return "";
    default:
      return element.children.map(textOf).join("");
  }
}

function paragraphOf(paragraph: XmlElement): { style: string; text: string } {
  const [properties] = childrenOf(paragraph, "w:pPr");
  const [style] = childrenOf(properties, "w:pStyle");
  return { style: style?.attributes["w:val"] ?? "", text: textOf(paragraph) };
}

/**
 * The body's paragraphs outside tables, in order: its style ("" for none) and its words, a line
 * break as "\n".
 */
export function paragraphsOf(documentXml: string): { style: string; text: string }[] {
  return bodyOf(documentXml)
    .filter((element) => element.tag === "w:p")
    .map(paragraphOf);
}

/**
 * What the body holds, in order, as the tag of each child: "w:p" for a paragraph outside a table,
 * "w:tbl" for a table, and "w:sectPr", the page's setup, last. Word joins two tables with nothing
 * between them into one, so a test reads what stands between two.
 */
export function bodyTags(documentXml: string): string[] {
  return bodyOf(documentXml).map(({ tag }) => tag);
}

/**
 * The words of each paragraph outside a table that keeps with the paragraph after it: its own
 * properties set `w:keepNext` (a value of off, false, or 0 takes it back), not its style's.
 */
export function keptWithNext(documentXml: string): string[] {
  return bodyOf(documentXml)
    .filter((element) => element.tag === "w:p")
    .filter((paragraph) => {
      const [marker] = childrenOf(childrenOf(paragraph, "w:pPr")[0], "w:keepNext");
      return (
        marker !== undefined && !["off", "false", "0"].includes(marker.attributes["w:val"] ?? "")
      );
    })
    .map((paragraph) => paragraphOf(paragraph).text);
}

/**
 * Each table: whether its first row repeats as a header, and each row's cells' words (a cell's
 * paragraphs joined by "\n").
 */
export function tablesOf(documentXml: string): { header: boolean; rows: string[][] }[] {
  return bodyOf(documentXml)
    .filter((element) => element.tag === "w:tbl")
    .map((table) => {
      const rows = childrenOf(table, "w:tr");
      const [firstProperties] = childrenOf(rows[0], "w:trPr");
      const [marker] = childrenOf(firstProperties, "w:tblHeader");
      return {
        // Word writes the marker bare; a value of off, false, or 0 takes it back.
        header:
          marker !== undefined && !["off", "false", "0"].includes(marker.attributes["w:val"] ?? ""),
        rows: rows.map((row) =>
          childrenOf(row, "w:tc").map((cell) =>
            childrenOf(cell, "w:p")
              .map((paragraph) => paragraphOf(paragraph).text)
              .join("\n"),
          ),
        ),
      };
    });
}

/**
 * A property of the document, by its tag in the core properties' XML (`dc:title`, `dc:creator`): its
 * words, with the XML's escapes read back, so a name with `&` or `'` in it compares as it is.
 */
export function propertyOf(core: string, tag: string): string {
  const [found] = descendants(parse(core), tag);
  return found?.children.map((child) => child.text).join("") ?? "";
}

/** The words of each run of the footer's text, in order: its own words, and then what follows them. */
export function footerWords(footer: string): string[] {
  return descendants(parse(footer), "w:t").map((run) =>
    run.children.map((child) => child.text).join(""),
  );
}

/** Each address the document links out to, once, in order. */
export function linksOf(parts: DocxParts): string[] {
  const addresses = new Map<string, string>();
  for (const { attributes } of descendants(parse(parts.rels), "Relationship")) {
    const { Id, Target, TargetMode } = attributes;
    if (TargetMode === "External" && Id !== undefined && Target !== undefined) {
      addresses.set(Id, Target);
    }
  }
  const ids = descendants(bodyOf(parts.document), "w:hyperlink").map(
    ({ attributes }) => attributes["r:id"] ?? "",
  );
  return [...new Set(ids.flatMap((id) => addresses.get(id) ?? []))];
}

/** A picture in the document, as its XML gives it. */
export interface Drawing {
  /** What a screen reader says of it: the `descr` of its `wp:docPr`. */
  descr: string;
  /** The `name` and `title` of the same element, which the Word copy gives the same words. */
  name: string;
  title: string;
  /** Its id, which no other picture in the document may share. */
  id: string;
  /** Its size on the page, in pixels (the XML counts 9,525 EMU to a pixel). */
  width: number;
  height: number;
  /** Its file in `word/media/`, by its name there, as the document's relationships give it. */
  file: string;
}

/** English Metric Units in a pixel: what Word's XML counts a picture's size in. */
const EMU_PER_PIXEL = 9525;

/** Each picture in the document, in the order the file has them, wherever it is: in a table too. */
export function drawingsOf(parts: DocxParts): Drawing[] {
  const targets = new Map<string, string>();
  for (const { attributes } of descendants(parse(parts.rels), "Relationship")) {
    const { Id, Target } = attributes;
    if (Id !== undefined && Target !== undefined) targets.set(Id, Target);
  }
  return descendants(bodyOf(parts.document), "w:drawing").map((drawing) => {
    const [properties] = descendants([drawing], "wp:docPr");
    const [extent] = descendants([drawing], "wp:extent");
    const [blip] = descendants([drawing], "a:blip");
    const target = targets.get(blip?.attributes["r:embed"] ?? "") ?? "";
    return {
      descr: properties?.attributes.descr ?? "",
      name: properties?.attributes.name ?? "",
      title: properties?.attributes.title ?? "",
      id: properties?.attributes.id ?? "",
      width: Number(extent?.attributes.cx) / EMU_PER_PIXEL,
      height: Number(extent?.attributes.cy) / EMU_PER_PIXEL,
      file: target.replace(/^media\//, ""),
    };
  });
}
