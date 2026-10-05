/**
 * A real JPEG, 16 pixels wide and 12 high: a page in miniature, with a dark bar for its header, two
 * lines of text, and a button. Chromium drew and encoded it, and a browser reads it, so a test can
 * put it wherever a run keeps a screenshot (365 bytes, with the color profile Chromium added left
 * out).
 */
export const TINY_JPEG: Uint8Array = new Uint8Array(
  Buffer.from(
    [
      "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywt",
      "QFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09P",
      "T09PT09PT09PT09PT09PT09PT0//wAARCAAMABADASIAAhEBAxEB/8QAFwAAAwEAAAAAAAAAAAAAAAAAAwQFBv/EACMQ",
      "AAAEBQQDAAAAAAAAAAAAAAECAxEABAUTIQYSFKExQmP/xAAUAQEAAAAAAAAAAAAAAAAAAAAD/8QAGBEBAQEBAQAAAAAA",
      "AAAAAAAAAQIAITH/2gAMAwEAAhEDEQA/AKq+i6EiqZM0xPOX7oh0IAMEQ0JSFtolPUthve6kIdAMahWnXJ4JrmzpWMU1",
      "oqrJ4bDN4Fsw7DW1Id9xyCvN/9k=",
    ].join(""),
    "base64",
  ),
);
