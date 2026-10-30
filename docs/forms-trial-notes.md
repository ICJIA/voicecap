# Forms trial

Run on 2026-10-30T17:52:39.609Z, on win32, by `pnpm forms:trial`.

## Each field, by Tab
- **Tab to the name:** "main landmark. form landmark. Your name, edit, required, blank"
- **Tab to the email:** "Email, edit, required, blank"
- **Tab to the radio:** "Contact by, grouping. Phone, radio button, not checked, required, invalid entry, 1 of 2"
- **Tab to the list:** "Topic, combo box, Choose one, collapsed, required, invalid entry"
- **Tab to the check box:** "I agree, check box, not checked, required, invalid entry"
- **Tab to the button:** "Send, button"

## Pressed empty: a page's own error, in an alert
- **Enter:** "6 problems: name, email, contact, topic, agree needed." (by 500 ms)

## Pressed empty: Chrome's own bubble
- **Enter:** "Your name, edit, required, blank. Please fill out this field., alert" (by 500 ms)

## Filled by keyboard
- **Type a name:** "v" (by 500 ms); "o" (by 500 ms); "i" (by 500 ms); "c" (by 500 ms); "e" (by 500 ms); "a" (by 500 ms); "p" (by 500 ms); "space" (by 500 ms); "t" (by 500 ms); "s" (by 500 ms)
- **Type an email:** "t" (by 500 ms); "e" (by 500 ms); "s" (by 500 ms); "at" (by 500 ms); "x" (by 500 ms); "a" (by 500 ms); "m" (by 500 ms); "p" (by 500 ms); "l" (by 500 ms); "dot" (by 500 ms); "c" (by 500 ms); "o" (by 500 ms)
- **Space on the radio:** "checked" (by 500 ms)
- **Down Arrow on the list:** "Grants" (by 500 ms)
- **Space on the check box:** "checked" (by 500 ms)
- **Enter on the button:** "Ready to send." (by 500 ms)

"Ready to send." among the last words means the keys reached every field.
