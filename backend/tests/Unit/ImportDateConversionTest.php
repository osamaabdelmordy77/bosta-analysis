<?php

namespace Tests\Unit;

use App\Imports\ImportIngestionService;
use PHPUnit\Framework\Attributes\DataProvider;
use ReflectionMethod;
use Tests\TestCase;

class ImportDateConversionTest extends TestCase
{
    #[DataProvider('dates')]
    public function test_dates_keep_their_epoch_timezone_and_microseconds(mixed $raw, string $calendar, string $timezone, string $expected): void
    {
        $converter = new ReflectionMethod(ImportIngestionService::class, 'convertTypedValue');
        $service = new ImportIngestionService;
        self::assertSame([$expected, true], $converter->invoke($service, $raw, 'dateTime', $calendar, $timezone));
        // Reusing timezone instances must not change later conversions.
        self::assertSame([$expected, true], $converter->invoke($service, $raw, 'dateTime', $calendar, $timezone));
    }

    public static function dates(): array
    {
        return [
            [25569, '1900', 'UTC', '1970-01-01 00:00:00.000000'],
            [24107, '1904', 'UTC', '1970-01-01 00:00:00.000000'],
            [25569.5, '1900', 'Africa/Cairo', '1970-01-01 10:00:00.000000'],
            [24107.5, '1904', 'Africa/Cairo', '1970-01-01 10:00:00.000000'],
            ['2026-09-28 11:22:33.123456', '1900', 'Africa/Cairo', '2026-09-28 08:22:33.123456'],
            ['2026-01-01 11:22:33.123456', '1900', 'Africa/Cairo', '2026-01-01 09:22:33.123456'],
            ['08-15-2026, 20:39:46', '1900', 'Africa/Cairo', '2026-08-15 17:39:46.000000'],
            ['08-15-2026, 20:39:46.123456', '1900', 'Africa/Cairo', '2026-08-15 17:39:46.123456'],
        ];
    }

    public function test_invalid_bosta_csv_date_does_not_roll_over(): void
    {
        $converter = new ReflectionMethod(ImportIngestionService::class, 'convertTypedValue');
        self::assertSame([null, false], $converter->invoke(new ImportIngestionService, '13-45-2026, 20:39:46', 'dateTime', '1900', 'UTC'));
    }
}
