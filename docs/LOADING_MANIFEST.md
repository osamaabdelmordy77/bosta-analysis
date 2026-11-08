# Loading mainfest

The Loading page's `mainfest` tab compares an XLSX Master Seal export with one car's seal list from CARS. Uploads require `shipments.view_all` and `imports.manage`; reading history requires `shipments.view_all`.

Select the operation day. The backend selects only the matching dated worksheet in the Google workbook (day-month-year tab names, with optional prefixes and spacing). The exact source tab and date are displayed. Enter the actual vehicle/plate number on the relevant CAR/ALEX card and upload that vehicle's XLSX (up to 10 MB / 100,000 rows / 20 sheets). Required columns are `Master Seal Number`, `Seal Number`, `Tracking Number`. Additional source status/hub/type fields are retained. Missing dated tabs return no cars; no fallback to gid=0, palet or another day is allowed.

Daily CARS worksheets use CAR or ALEX slots (including split `car` + adjacent numeric cells), master seals and seal columns. The day comes from the worksheet name. They do not contain a reliable plate or tracking list. Therefore:

- Day must match the selected dated worksheet. Vehicle/plate is explicitly declared by the uploader; neither is inferred from the fetch timestamp.
- Tabs without a complete year are not assigned a guessed year. Multiple tabs for one date require an explicit tab selection.
- A filename date is checked against the selected day. Ambiguous month/day dates expose both possible interpretations; ISO dates are unambiguous.
- A CAR number in the filename is checked when available. The template's upload selection otherwise supplies that binding.
- A master seal must be present and agree in every uploaded row. Missing or mixed master seals make identity provisional.
- The same dated CARS tab is fetched again before saving, and its date, tab name and per-car fingerprint must match. Changed sheet entries require refresh and reconfirmation.
- Seal membership is compared, not physical loading or delivery status. A CARS-only seal's tracking list is unknown, not zero shipments. Number is never used as a shipment count.

Results distinguish matched, CARS-only and file-only seals, source row numbers, duplicate tracking rows, a tracking appearing in multiple seals, missing identifiers and seals listed for other cars. Details and Excel exports preserve original tracking strings, including leading zeros.

The `manifests_private` filesystem disk stores originals and JSON reports under organization/day/ULID. JSON is published by rename after the original is saved. No report overwrites another; stored CARS snapshots keep historical results stable. This is server-side private storage, not browser storage or Git; include this disk in the application's normal data backups. No database migrations are required.

Legacy comparisons created from gid=0 are preserved but marked as having an unverified source day. They must be re-uploaded to produce a verified daily-tab comparison. Excel exports include the source tab name and date.

Run `php vendor/bin/phpunit tests/Unit/LoadingManifestTest.php tests/Unit/CarsSheetControllerTest.php` from backend and `npm run verify:loading-manifest` from the root. These use synthetic fixtures and private fake storage; they do not upload the user's original file or write application database rows.
