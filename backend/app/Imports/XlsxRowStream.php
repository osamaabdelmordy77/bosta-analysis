<?php

namespace App\Imports;

use DateTimeInterface;
use OpenSpout\Common\Entity\Cell\FormulaCell;
use OpenSpout\Common\Helper\Escaper\XLSX;
use OpenSpout\Reader\XLSX\Helper\CellValueFormatter;
use OpenSpout\Reader\XLSX\Helper\DateIntervalFormatHelper;
use OpenSpout\Reader\XLSX\Manager\SharedStringsCaching\CachingStrategyFactory;
use OpenSpout\Reader\XLSX\Manager\SharedStringsCaching\MemoryLimit;
use OpenSpout\Reader\XLSX\Manager\SharedStringsManager;
use OpenSpout\Reader\XLSX\Manager\StyleManager;
use OpenSpout\Reader\XLSX\Manager\WorkbookRelationshipsManager;
use OpenSpout\Reader\XLSX\Options;
use RuntimeException;

/** Single-pass XLSX values, without per-cell objects or a second XML reader. */
final class XlsxRowStream
{
    /** @return \Generator<int,array{0:int,1:list<mixed>}> */
    public function rows(string $path, string $target, string $dateSystem): \Generator
    {
        $options = new Options;
        $temp = (string) config('import_ingestion.reader_temp_path', storage_path('app/private/import-work'));
        if (! is_dir($temp) && ! mkdir($temp, 0700, true) && ! is_dir($temp)) {
            throw new RuntimeException('The private workbook reader directory could not be created.');
        }
        $options->setTempFolder($temp);
        $relationships = new WorkbookRelationshipsManager($path);
        $strings = new SharedStringsManager($path, $options, $relationships,
            new CachingStrategyFactory(new MemoryLimit(ini_get('memory_limit'))));
        $styles = new StyleManager($path, $relationships->hasStylesXMLFile() ? $relationships->getStylesXMLFilePath() : null);
        $escaper = new XLSX;
        $formatter = new CellValueFormatter($strings, $styles, false, $dateSystem === '1904', $escaper);
        $dateStyles = [];
        $durationStyles = [];
        $columns = [];
        $xml = new \XMLReader;
        $previousErrors = libxml_use_internal_errors(true);
        libxml_clear_errors();
        try {
            if ($strings->hasSharedStrings()) {
                $strings->extractSharedStrings();
            }
            if (! $xml->open('zip://'.str_replace('\\', '/', $path).'#'.$target, null, LIBXML_NONET | LIBXML_COMPACT)) {
                throw new RuntimeException('The XLSX worksheet could not be opened.');
            }
            $number = 0;
            $values = [];
            $lastColumn = -1;
            $rowDepth = null;
            while ($xml->read()) {
                if ($xml->nodeType === \XMLReader::DOC_TYPE) {
                    throw new RuntimeException('XLSX worksheets must not contain a document type.');
                }
                if ($xml->nodeType === \XMLReader::END_ELEMENT && $xml->localName === 'row' && $xml->depth === $rowDepth) {
                    if ($values !== []) {
                        $values = array_replace(array_fill(0, max(array_keys($values)) + 1, null), $values);
                    }
                    yield [$number, $values];
                    $rowDepth = null;

                    continue;
                }
                if ($xml->nodeType !== \XMLReader::ELEMENT) {
                    continue;
                }
                if ($xml->localName === 'row') {
                    $number = (int) ($xml->getAttribute('r') ?: ($number + 1));
                    if ($number > (int) config('import_ingestion.max_source_row_number', 200000)) {
                        throw new RuntimeException('The workbook exceeds the supported source row number limit.');
                    }
                    $values = [];
                    $lastColumn = -1;
                    $rowDepth = $xml->isEmptyElement ? null : $xml->depth;
                    if ($xml->isEmptyElement) {
                        yield [$number, []];
                    }

                    continue;
                }
                if ($xml->localName !== 'c' || $rowDepth === null) {
                    continue;
                }
                $reference = (string) $xml->getAttribute('r');
                $letters = rtrim($reference, '0123456789');
                if ($letters === '') {
                    $index = $lastColumn + 1;
                } elseif (isset($columns[$letters])) {
                    $index = $columns[$letters];
                } else {
                    $index = 0;
                    for ($i = 0, $length = strlen($letters); $i < $length; $i++) {
                        $index = $index * 26 + ord($letters[$i]) - 64;
                    }
                    $index = $columns[$letters] = $index - 1;
                }
                if ($index < 0 || $index >= 512) {
                    throw new RuntimeException('The workbook exceeds the supported 512 source columns.');
                }
                $lastColumn = $index;
                $type = (string) $xml->getAttribute('t');
                $style = (int) $xml->getAttribute('s');
                $depth = $xml->depth;
                $raw = '';
                $text = '';
                $formula = false;
                if (! $xml->isEmptyElement) {
                    while ($xml->read()) {
                        if ($xml->nodeType === \XMLReader::END_ELEMENT && $xml->localName === 'c' && $xml->depth === $depth) {
                            break;
                        }
                        if ($xml->nodeType === \XMLReader::ELEMENT) {
                            if ($xml->localName === 'v') {
                                $raw = $xml->readString();
                            } elseif ($xml->localName === 't') {
                                $part = $xml->readString();
                                $text .= str_contains($part, '_x') ? $escaper->unescape($part) : $part;
                            } elseif ($xml->localName === 'f') {
                                $formula = true;
                            }
                        }
                    }
                }
                if ($type === 'inlineStr') {
                    $value = $text;
                } elseif ($raw === '' && ! $formula) {
                    $value = null;
                } elseif ($type === 's') {
                    $value = $escaper->unescape($strings->getStringAtIndex((int) $raw));
                } elseif ($type === '' || $type === 'n') {
                    $duration = $durationStyles[$style] ??= DateIntervalFormatHelper::isDurationFormat($styles->getNumberFormatCode($style));
                    $date = $dateStyles[$style] ??= $styles->shouldFormatNumericValueAsDate($style);
                    if ($duration) {
                        $value = DateIntervalFormatHelper::createDateIntervalFromHours((float) $raw);
                    } elseif ($date && $raw !== '') {
                        // Preserve all serial digits, including sub-second precision.
                        $value = $raw;
                    } else {
                        $integer = (int) $raw;
                        $float = (float) $raw;
                        $value = (float) $integer === $float ? $integer : $float;
                    }
                } elseif ($type === 'b') {
                    $value = (bool) $raw;
                } elseif ($type === 'str') {
                    $value = $escaper->unescape(trim($raw));
                } else {
                    // Keep library semantics for uncommon ISO dates and error cells.
                    $node = new \DOMDocument;
                    $cell = $node->createElement('c');
                    $cell->setAttribute('t', $type);
                    $cell->setAttribute('s', (string) $style);
                    $cell->appendChild($node->createElement('v'))->appendChild($node->createTextNode($raw));
                    if ($formula) {
                        $cell->appendChild($node->createElement('f'));
                    }
                    $formatted = $formatter->extractAndFormatNodeValue($cell);
                    $value = $formatted instanceof FormulaCell ? $formatted->getComputedValue() : $formatted->getValue();
                    if ($value instanceof DateTimeInterface) {
                        $epoch = $dateSystem === '1904' ? '1904-01-01' : '1899-12-30';
                        $value = ((new \DateTimeImmutable($value->format('Y-m-d H:i:s'), new \DateTimeZone('UTC')))->getTimestamp()
                            - (new \DateTimeImmutable($epoch, new \DateTimeZone('UTC')))->getTimestamp()) / 86400;
                    }
                }
                $values[$index] = $value === '' ? null : $value;
            }
            $error = libxml_get_last_error();
            if ($error !== false && $error->level >= LIBXML_ERR_ERROR) {
                throw new RuntimeException('The XLSX worksheet contains invalid XML.');
            }
        } finally {
            $xml->close();
            $strings->cleanup();
            libxml_clear_errors();
            libxml_use_internal_errors($previousErrors);
        }
    }
}
