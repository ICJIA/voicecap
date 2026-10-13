/**
 * A file's name without its folders: the last part of its path, cut at / or \. A page list or a
 * walkthrough file is named by this alone in a walkthrough file, on the shareable page, and in a
 * run's record of one from outside the folder voicecap runs in, since a full path can carry the
 * person's user name. A sitemap's address and --page addresses stay whole.
 */
export function fileNameOf(file: string): string {
  return file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1);
}
