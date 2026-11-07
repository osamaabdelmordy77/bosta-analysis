<?php

namespace Tests\Unit;

use App\Reports\ReceiveVolumeWorkbook;
use PhpOffice\PhpSpreadsheet\IOFactory;
use PhpOffice\PhpSpreadsheet\Writer\Xlsx;
use PHPUnit\Framework\TestCase;
use ZipArchive;

class ReceiveVolumeWorkbookTest extends TestCase
{
    public function test_export_has_reconciled_comparisons_and_three_native_pivots(): void
    {
        $rows = [
            ['date' => '2026-11-07', 'weekday' => 'Saturday', 'week' => '2026-11-07', 'window' => '14:00–17:00', 'shipments' => 3, 'items' => 4],
            ['date' => '2026-11-07', 'weekday' => 'Saturday', 'week' => '2026-11-07', 'window' => '17:00–19:00', 'shipments' => 2, 'items' => 2],
            ['date' => '2026-11-14', 'weekday' => 'Saturday', 'week' => '2026-11-14', 'window' => '14:00–17:00', 'shipments' => 4, 'items' => 4],
            ['date' => null, 'weekday' => null, 'week' => null, 'window' => 'Missing / invalid time', 'shipments' => 1, 'items' => 1],
        ];
        $book = (new ReceiveVolumeWorkbook)->build($rows);
        $daily = $book->getSheetByName('Daily comparison');
        self::assertSame('2026-11-07', $daily->getCell('A2')->getValue());
        self::assertSame('2026-11-14', $daily->getCell('A3')->getValue());
        self::assertEquals(5, $daily->getCell('H2')->getCalculatedValue());
        self::assertEquals(10, $daily->getCell('H5')->getCalculatedValue());
        self::assertEquals(1, $daily->getCell('J2')->getCalculatedValue());
        self::assertEquals(-0.2, $daily->getCell('K3')->getCalculatedValue());
        self::assertEquals(9, $book->getSheetByName('Weekday comparison')->getCell('H2')->getCalculatedValue());
        foreach (['Pivot dates', 'Pivot weekdays', 'Pivot weeks'] as $name) {
            self::assertCount(1, $book->getSheetByName($name)->getPivotTables());
        }
        $path = tempnam(sys_get_temp_dir(), 'receive-volume-');
        try {
            (new Xlsx($book))->save($path);
            $zip = new ZipArchive;
            self::assertTrue($zip->open($path));
            $pivots = 0;
            $caches = 0;
            for ($index = 0; $index < $zip->numFiles; $index++) {
                $name = $zip->getNameIndex($index);
                if (preg_match('#^xl/pivotTables/pivotTable\d+\.xml$#', $name)) {
                    $pivots++;
                    $xml = $zip->getFromIndex($index);
                    self::assertStringContainsString('pivotTableDefinition', $xml);
                    // OOXML omits subtotal when it is the default (sum).
                    self::assertStringNotContainsString('subtotal="count"', $xml);
                }
                if (preg_match('#^xl/pivotCache/pivotCacheDefinition\d+\.xml$#', $name)) {
                    $caches++;
                    self::assertStringContainsString('refreshOnLoad="1"', $zip->getFromIndex($index));
                }
            }
            self::assertSame(3, $pivots);
            self::assertGreaterThanOrEqual(1, $caches);
            $zip->close();
            $loaded = IOFactory::load($path);
            self::assertEquals(10, $loaded->getSheetByName('Daily comparison')->getCell('H5')->getCalculatedValue());
            self::assertCount(1, $loaded->getSheetByName('Pivot dates')->getPivotTables());
            $loaded->disconnectWorksheets();
        } finally {
            $book->disconnectWorksheets();
            unlink($path);
        }
    }
}
