# Easily Distracted Invoices

A small, private invoicing dashboard for **Easily Distracted Games**. It tracks sponsor campaigns from *new* → *waiting for payment* → *paid*, makes PDF invoices in the house style, and keeps everything in a **private GitHub repo** that only you can read.

The month-to-month revenue dashboard (AdSense + sponsors + other income) is the next phase. The data file already has a slot for it.

## How it stays private

There are two repos:

| Repo | What's in it | Visibility |
|---|---|---|
| `easily-distracted-invoices` (this code) | The app. **No personal data at all.** | Public or private |
| `invoice-data` | One file, `data/ledger.json`: your details, bank, clients, invoices | **Private** |

The app runs entirely in your browser. When you open it on a new device, you paste a GitHub token that can only read/write the `invoice-data` repo. The token stays in that browser. Anyone else who finds the app's URL just sees the "Connect" screen, with nothing behind it.

## Setup (about 10 minutes)

### 1. Create the private data repo
1. On GitHub: **New repository** → name it `invoice-data` → **Private** → tick **Add a README** → Create.
2. *(Optional)* Upload `starter-ledger.json` into a `data` folder as `data/ledger.json`. Or skip this and load the starter file from the Connect screen instead.

### 2. Create a token
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Repository access:** Only select repositories → `invoice-data`.
3. **Permissions → Repository permissions → Contents:** Read and write. Leave everything else as is.
4. Set an expiry (a year is fine) → Generate → copy it (it starts with `github_pat_`).

### 3. Put the app online
Pick one:

- **GitHub Pages (simplest):** push this folder to a repo, then **Settings → Pages → Deploy from branch → `main` / root**. On a free GitHub plan Pages only works for **public** repos. That's fine here, because this repo has no data in it. On GitHub Pro, a private repo works too.
- **Cloudflare Pages or Netlify (free, private repo OK):** connect the repo, no build command, output directory `/`.

Then open the site → enter your username, `invoice-data`, and the token → **Connect**. On the first connect, pick `starter-ledger.json` under "Load a starter or backup file" to pre-fill your details, clients and past invoices.

> To run it on your computer instead: `python3 -m http.server 8000` in this folder, then open http://localhost:8000. Opening `index.html` directly from disk won't work, because browsers block modules on `file://`.

## What it does

**Invoice tracker**
- Spreadsheet-style table: Invoice #, Status, Client, Campaign, Reference, Date, Due, Reminder, Total. Click a header to sort.
- Change the status right in the table. *Overdue* is worked out automatically from the due date.
- Summary cards: outstanding, overdue, paid this year (in EUR), and reminders due. Click a card to filter.
- Search, filters by status and year, "show totals in" invoice currency / EUR / USD, and CSV export.
- Row actions: download PDF, draft a reminder email, duplicate, delete (with undo).
- On a phone, the table turns into cards.

**Invoice editor**
- Live A4 preview next to the form. On phone or tablet, switch between Edit and Preview.
- Numbers run in sequence (A00021, A00022, …). Duplicate numbers are blocked.
- Payment terms chips (15/30/45/60) keep the due date in sync. Reminder date presets: on the due date, +7 days, or none.
- Line items with descriptions, reordering, and **saved items** (e.g. "Integrated Video (60-90s)" at your usual rate).
- **EUR ⇄ USD:** pick the invoice currency. When you switch, choose whether to *convert the amounts* at the rate or *keep the numbers*. The rate is the ECB reference rate for the invoice date (free Frankfurter API). You can type your own, and the rate used is saved with the invoice.
- **Mark as paid** asks for the date and the euros that actually reached your bank (one tap fills in the ECB rate for that day). That figure is what feeds your EUR totals, which is what URSSAF needs.
- **Reminder email:** opens your mail app with a friendly, pre-written reminder, and pushes the next reminder back 7 days.
- **PDF:** "PDF" downloads a file named from your template. "Print" uses the browser's print dialog, which gives selectable vector text and uses the same file name.

**Clients:** saved name, address, VAT number, SIREN, billing email, usual currency and payment terms, plus private notes. Each invoice keeps a copy of the client's details as they were on the day you billed, so editing a client later never rewrites old invoices.

**Settings:** your details (EI, SIRET, intra-EU VAT number), bank, numbering, defaults, legal text, signature (upload a photo with automatic background removal, or draw one with mouse, finger or pen), the PDF file-name template, saved items, and backup/restore.

## French invoice rules built in

These are on by default and editable in **Settings → Invoice & legal**:

- **"EI"** after your name, and your **SIRET**.
- **Service date** (date of the service) alongside the invoice date.
- **VAT franchise:** "TVA non applicable, art. L. 223-3 du CIBS". This is the updated reference that replaces art. 293 B du CGI.
- **EU business clients** (e.g. a Belgian or German sponsor): the app automatically switches to the **reverse-charge** mention (*autoliquidation*, art. 283-2 CGI). It also asks for **your intra-EU VAT number**, which you need for these clients even under the franchise. Request one from your SIE if you don't have it, and file the **DES** for those invoices.
- **Late-payment penalties / €40 recovery fee:** off by default, as you asked. There's a field in Settings if you ever want to add them. French rules expect them on B2B invoices, so it’s worth checking with your accountant.
- **Nature of the transaction:** services. This has been required since 1 Sept 2026.
- **Client SIREN** field for French business clients, also required since 1 Sept 2026.
- **Unbroken numbering.** The app warns you before you delete an invoice you've already sent.

*I'm not a lawyer or an accountant. Have your accountant check the wording once.*

## Files

```
index.html                 app shell
css/styles.css             app styles (white + greens)
css/invoice.css            the printable A4 invoice
js/app.js                  routing, connect screen, sync status
js/store.js                data model, GitHub sync, offline cache
js/github.js               GitHub Contents API
js/rates.js                ECB exchange rates (Frankfurter)
js/invoice.js              invoice template, PDF + print, file names
js/invoice-actions.js      paid / reminders / duplicate / delete
js/view-*.js               the screens
js/signature.js            signature upload clean-up + drawing pad
vendor/html2pdf.bundle.min.js   PDF generation (MIT)
assets/                    logo + fonts (Open Sans, Manrope, OFL)
```

No build step and no dependencies to install.

## Keyboard shortcuts
- **N**: new invoice
- **/**: search
- **Ctrl/⌘ + S**: save the invoice you're editing
