<?php

namespace Tests\Unit;

use App\Imports\XlsxRowStream;
use RuntimeException;
use Tests\TestCase;
use ZipArchive;

class XlsxRowStreamTest extends TestCase
{
    public function test_single_pass_reader_preserves_prefixed_rich_text_sparse_cells_and_cached_formulas(): void
    {
        $xml = <<<'XML'
        <x:worksheet xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><x:sheetData>
          <x:row r="2">
            <x:c r="A2" t="inlineStr"><x:is><x:r><x:t xml:space="preserve">  first &amp; </x:t></x:r><x:r><x:t><![CDATA[<second>]]></x:t></x:r></x:is></x:c>
            <x:c r="C2" t="inlineStr"><x:is><x:t>00001234</x:t></x:is></x:c>
            <x:c r="D2" t="b"><x:v>0</x:v></x:c>
            <x:c r="E2"><x:f>1+2</x:f><x:v>3</x:v></x:c>
            <x:c r="F2" t="str"><x:f>"cached"</x:f><x:v>cached</x:v></x:c>
            <x:c r="G2" t="e"><x:f>1/0</x:f><x:v>#DIV/0!</x:v></x:c>
            <x:c r="H2" t="inlineStr"><x:is><x:t>_x005F_x0000_</x:t></x:is></x:c>
            <x:c r="I2"><x:v>1.25</x:v></x:c>
          </x:row><x:row r="5"/><x:row><x:c r="A6" t="inlineStr"><x:is><x:t>last</x:t></x:is></x:c></x:row>
        </x:sheetData></x:worksheet>
        XML;
        $path = $this->workbook($xml);
        try {
            $rows = iterator_to_array((new XlsxRowStream)->rows($path, 'xl/worksheets/sheet1.xml', '1900'), false);
            self::assertSame([2, ['  first & <second>', null, '00001234', false, 3, 'cached', null, '_x0000_', 1.25]], $rows[0]);
            self::assertSame([5, []], $rows[1]);
            self::assertSame([6, ['last']], $rows[2]);
        } finally {
            unlink($path);
        }
    }

    public function test_malformed_xml_cannot_be_silently_published_as_a_partial_workbook(): void
    {
        $path = $this->workbook('<worksheet><sheetData><row r="1"><c r="A1"><v>1</v></c></row><row>');
        try {
            $this->expectException(RuntimeException::class);
            iterator_to_array((new XlsxRowStream)->rows($path, 'xl/worksheets/sheet1.xml', '1900'));
        } finally {
            unlink($path);
        }
    }

    public function test_column_limit_is_enforced_even_when_the_header_sample_is_narrow(): void
    {
        $path = $this->workbook('<worksheet><sheetData><row r="300"><c r="SS300"><v>1</v></c></row></sheetData></worksheet>');
        try {
            $this->expectException(RuntimeException::class);
            $this->expectExceptionMessage('512 source columns');
            iterator_to_array((new XlsxRowStream)->rows($path, 'xl/worksheets/sheet1.xml', '1900'));
        } finally {
            unlink($path);
        }
    }

    private function workbook(string $xml): string
    {
        $path = tempnam(sys_get_temp_dir(), 'bosta-xlsx-');
        $zip = new ZipArchive;
        self::assertTrue($zip->open($path, ZipArchive::OVERWRITE) === true);
        $zip->addFromString('xl/_rels/workbook.xml.rels', '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>');
        $zip->addFromString('xl/worksheets/sheet1.xml', $xml);
        $zip->close();

        return $path;
    }
}
