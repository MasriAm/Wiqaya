# Privacy in Wiqaya

Wiqaya handles children's health information, which Jordan's Personal Data Protection Law (2023) treats as
sensitive. The design goal: **the product is shared, the person never is.**

## Who sees what

| Data | Phone | Wiqaya server | Gemma |
|---|---|---|---|
| Names, allergies, diets, medicines, the doctor's plan | yes, encrypted | no (only encrypted family messages it can't read) | never |
| Who is allergic to what | yes | no | no |
| Label photo | yes | passes through, cleaned, not stored | yes (the label only) |
| Barcode scanned | yes | yes, not linked to anyone | no |
| Ingredient list read from a photo of a product Open Food Facts doesn't have | yes | kept with the barcode (only when the reading passed every check), so the next scan of that product is instant; never who scanned it | yes (the label only) |
| Restaurant menu (link, photo or PDF) | yes, with the result | fetches the link or passes the file through, not stored | yes (the menu only) |
| Location | only inside the emergency text, written on the phone | no | no |
| Scan history | yes, and the family (encrypted) | no | no |

## How

1. **The check runs on the phone.** The server returns facts about a product (its ingredients, "contains" and
   "may contain" lines). The allergen engine (`web/src/engine`) matches them against profiles on the phone.
2. **Gemma gets the product, never the person.** Prompts contain label photos, ingredient names and product names.
   When the app asks Gemma to explain findings, it sends every finding in the product, not just the ones that
   matter to this family, so the request doesn't hint at anyone's allergy. `tests/test_server.py` checks this.
3. **Clean photos.** Each photo is decoded and rebuilt from its pixels (`wiqaya/images.py`): no EXIF, no GPS, no
   device model. It is held in memory for the request and never written to disk.
4. **No accounts.** A family is a random 128-bit id plus a 256-bit key. Both travel only inside the invite QR code,
   in the URL fragment (`#join=…`), which browsers never send to a server.
5. **End-to-end encryption.** Every family message is encrypted on the phone with AES-GCM (`web/src/lib/crypto.ts`).
   The relay (`wiqaya/relay.py`) accepts only encrypted bodies and deletes them after 30 days.
6. **Only parents change profiles.** Profile updates, approvals and removals are signed with a parent's ECDSA key;
   other phones ignore unsigned or badly signed ones.
7. **Encrypted at rest.** The app's saved state is encrypted with a non-extractable key kept in the browser.
8. **No logs.** The server runs with access logs off.
9. **Leaving is easy.** Settings → "Delete everything on this phone".

## What the server can still see

The barcodes, label photos and restaurant menus checked through it, and the size and timing of encrypted family
messages. It never learns who a menu was checked for. It opens menu links only on public addresses, never on your
local network. Run your
own server (it's one command) if that matters to you.
