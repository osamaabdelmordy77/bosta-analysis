<?php

namespace App\Reports;

use PhpOffice\PhpSpreadsheet\Cell\DataType;
use PhpOffice\PhpSpreadsheet\Spreadsheet;
use PhpOffice\PhpSpreadsheet\Worksheet\PivotTable\PivotField;
use PhpOffice\PhpSpreadsheet\Worksheet\PivotTable\PivotTableBuilder;
use PhpOffice\PhpSpreadsheet\Worksheet\Worksheet;

class ReceiveVolumeWorkbook
{
    public const WINDOWS = ['Before 14:00', '14:00–17:00', '17:00–19:00', 'From 19:00', 'Missing / invalid time'];

    public const WEEKDAYS = ['Saturday', 'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

    /** @param array<int,array{date:?string,weekday:?string,week:?string,window:string,shipments:int,items:int|float}> $rows */
    public function build(array $rows): Spreadsheet
    {
        $book = new Spreadsheet;
        $book->removeSheetByIndex(0);
        $book->getProperties()->setTitle('Receive volume — filtered comparison')->setDescription('Received source clock time; Saturday–Friday weeks; imported snapshot record counts.');
        $dimensions = ['date' => 'Daily comparison', 'weekday' => 'Weekday comparison', 'week' => 'Weekly comparison'];
        foreach ($dimensions as $dimension => $title) {
            $groups = [];
            foreach ($rows as $row) {
                $key = $row[$dimension] ?: 'Missing / invalid time';
                $groups[$key] ??= ['weekday' => $row['weekday'] ?: '', 'counts' => array_fill(0, 5, 0), 'items' => 0];
                $index = array_search($row['window'], self::WINDOWS, true);
                $groups[$key]['counts'][$index] += $row['shipments'];
                $groups[$key]['items'] += $row['items'];
            }
            uksort($groups, static function (string $a, string $b) use ($dimension): int {
                if ($a === $b) {
                    return 0;
                }
                if ($a === 'Missing / invalid time') {
                    return 1;
                }
                if ($b === 'Missing / invalid time') {
                    return -1;
                }

                return $dimension === 'weekday' ? array_search($a, self::WEEKDAYS, true) <=> array_search($b, self::WEEKDAYS, true) : strcmp($a, $b);
            });
            $sheet = $book->createSheet()->setTitle($title);
            $this->writeRow($sheet, 1, [$dimension === 'week' ? 'Week starts Saturday' : ucfirst($dimension), 'Weekday (daily only)', ...self::WINDOWS, 'Total shipments', 'Items', '14–19 share', 'Change vs previous row']);
            $number = 2;
            $previous = null;
            foreach ($groups as $key => $group) {
                $total = array_sum($group['counts']);
                $this->writeRow($sheet, $number, [$key, $dimension === 'date' ? $group['weekday'] : '', ...$group['counts'], $total, $group['items']]);
                $sheet->setCellValue("J{$number}", "=IFERROR((D{$number}+E{$number})/H{$number},0)");
                if ($previous !== null && $previous > 0 && $dimension !== 'weekday' && $key !== 'Missing / invalid time') {
                    $last = $number - 1;
                    $sheet->setCellValue("K{$number}", "=IFERROR((H{$number}-H{$last})/H{$last},0)");
                }
                $previous = $total;
                $number++;
            }
            $sheet->setCellValue("A{$number}", 'Grand total');
            foreach (range('C', 'I') as $column) {
                $sheet->setCellValue("{$column}{$number}", '=SUM('.$column.'2:'.$column.($number - 1).')');
            }
            $sheet->setCellValue("J{$number}", "=IFERROR((D{$number}+E{$number})/H{$number},0)");
            $sheet->getStyle("J2:K{$number}")->getNumberFormat()->setFormatCode('0.0%');
            $sheet->getStyle("A{$number}:K{$number}")->getFont()->setBold(true);
            $this->style($sheet, "A1:K{$number}");
        }
        $source = $book->createSheet()->setTitle('Volume source');
        $this->writeRow($source, 1, ['Received date', 'Weekday', 'Week starts Saturday', 'Time group', 'Shipments', 'Items']);
        foreach ($rows as $index => $row) {
            $this->writeRow($source, $index + 2, [$row['date'] ?: 'Missing / invalid time', $row['weekday'] ?: 'Missing / invalid time', $row['week'] ?: 'Missing / invalid time', $row['window'], $row['shipments'], $row['items']]);
        }
        $last = count($rows) + 1;
        $this->style($source, "A1:F{$last}");
        foreach (['Received date' => 'Pivot dates', 'Weekday' => 'Pivot weekdays', 'Week starts Saturday' => 'Pivot weeks'] as $field => $title) {
            $sheet = $book->createSheet()->setTitle($title);
            $sheet->setCellValue('A1', 'Native Excel Pivot Table — refresh on open; use Data > Refresh All if needed. Ready summaries are in the comparison sheets.');
            $builder = new PivotTableBuilder($source, "A1:F{$last}");
            $builder->addRowField($field)->addColumnField('Time group')->addDataField('Shipments', PivotField::SUBTOTAL_SUM, 'Shipment count');
            if ($field !== 'Received date') {
                $builder->addPageField('Received date');
            }
            if ($field !== 'Week starts Saturday') {
                $builder->addPageField('Week starts Saturday');
            }
            $builder->build($sheet, 'A7', str_replace(' ', '', $title));
            $sheet->getColumnDimension('A')->setWidth(28);
        }
        $notes = $book->createSheet()->setTitle('Definitions');
        foreach ([
            ['Metric', 'Definition'],
            ['Time basis', 'Received Time source clock; not report date or browser UTC conversion.'],
            ['14:00–17:00', '14:00 inclusive; 17:00 exclusive.'],
            ['17:00–19:00', '17:00 inclusive; 19:00 exclusive.'],
            ['Other groups', 'Before 14:00, from 19:00, and missing / invalid Received Time reconcile to the filtered total.'],
            ['Date selection', 'The source contains only the active Receive + Volume date / weekday filters at download time.'],
            ['Weekly comparison', 'Week starts Saturday; full dates distinguish different weeks, months and years.'],
            ['Weekday comparison', 'Sums the same weekday across selected dates; daily comparison keeps those dates separate.'],
            ['Record count', 'Imported records, not unique tracking numbers. Repeated report snapshots are counted separately.'],
            ['Volume source', 'Aggregated date / time group counts; use the app group download for individual shipment details.'],
        ] as $index => $row) {
            $this->writeRow($notes, $index + 1, $row);
        }
        $notes->getColumnDimension('A')->setWidth(25);
        $notes->getColumnDimension('B')->setWidth(110);
        $notes->getStyle('B1:B10')->getAlignment()->setWrapText(true);
        $book->setActiveSheetIndex(0);

        return $book;
    }

    private function writeRow(Worksheet $sheet, int $row, array $values): void
    {
        foreach ($values as $index => $value) {
            $sheet->getCell([$index + 1, $row])->setValueExplicit($value, is_int($value) || is_float($value) ? DataType::TYPE_NUMERIC : DataType::TYPE_STRING);
        }
    }

    private function style(Worksheet $sheet, string $range): void
    {
        $sheet->freezePane('C2');
        $sheet->setAutoFilter($range);
        $sheet->getStyle('A1:'.$sheet->getHighestColumn().'1')->getFont()->setBold(true)->getColor()->setARGB('FFFFFFFF');
        $sheet->getStyle('A1:'.$sheet->getHighestColumn().'1')->getFill()->setFillType('solid')->getStartColor()->setARGB('FF174EA6');
        foreach ($sheet->getColumnIterator() as $column) {
            $sheet->getColumnDimension($column->getColumnIndex())->setWidth(24);
        }
        $sheet->getRowDimension(1)->setRowHeight(32);
        $sheet->getStyle($range)->getAlignment()->setVertical('center');
    }
}
