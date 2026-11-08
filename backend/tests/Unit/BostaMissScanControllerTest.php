<?php

namespace Tests\Unit;

use App\Http\Controllers\BostaMissScanController;
use App\Tenancy\OrganizationContext;
use Illuminate\Http\Request;
use Illuminate\Routing\Route;
use Illuminate\Session\ArraySessionHandler;
use Illuminate\Session\Store;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

class BostaMissScanControllerTest extends TestCase
{
    public function test_token_is_validated_and_kept_only_in_encrypted_session(): void
    {
        Http::fake(['beta-api.bosta.co/*' => Http::response(['result' => [['_id' => '030000000133', 'name' => 'Alex Sorting Facility']]])]);
        $request = Request::create('/api/organizations/demo/miss-scan/connection', 'POST', ['token' => 'Bearer secret-example']);
        $request->setLaravelSession(new Store('test', new ArraySessionHandler(120)));
        $context = new OrganizationContext;
        $context->set('org-test', 5, 1);

        $response = app(BostaMissScanController::class)->connect($request, $context);

        $this->assertSame(200, $response->status());
        $this->assertSame([['id' => '030000000133', 'name' => 'Alex Sorting Facility']], $response->getData(true)['data']['hubs']);
        $this->assertStringNotContainsString('secret-example', json_encode($request->session()->all()));
        $this->assertStringNotContainsString('secret-example', $response->getContent());
        Http::assertSent(fn ($sent): bool => $sent->hasHeader('Authorization', 'Bearer secret-example'));

        app(BostaMissScanController::class)->disconnect($request, $context);
        $this->assertFalse(app(BostaMissScanController::class)->status($request, $context)->getData(true)['data']['connected']);
    }

    public function test_page_uses_the_selected_hub_and_miss_scan_state(): void
    {
        Http::fake([
            'beta-api.bosta.co/*/hubs/list' => Http::response(['result' => [['_id' => 'hub-1', 'name' => 'Hub 1']]]),
            'beta-api.bosta.co/*/deliveries/search' => Http::response(['deliveries' => [['_id' => 'delivery-1', 'state' => ['code' => 24]]]]),
        ]);
        $session = new Store('test', new ArraySessionHandler(120));
        $context = new OrganizationContext;
        $context->set('org-test', 5, 1);
        $connect = Request::create('/connection', 'POST', ['token' => 'secret-example']);
        $connect->setLaravelSession($session);
        app(BostaMissScanController::class)->connect($connect, $context);

        $request = Request::create('/pages/2?hub_id=hub-1', 'GET');
        $request->setLaravelSession($session);
        $route = new Route('GET', 'pages/{page}', []);
        $route->bind($request);
        $request->setRouteResolver(static fn () => $route);
        $response = app(BostaMissScanController::class)->page($request, $context);

        $this->assertSame(200, $response->status());
        $this->assertSame('delivery-1', $response->getData(true)['data']['deliveries'][0]['_id']);
        Http::assertSent(fn ($sent): bool => str_contains($sent->url(), '/deliveries/search')
            && $sent['hubs'] === ['hub-1'] && $sent['stateCodes'] === ['24.2']
            && $sent['pageNumber'] === 2 && $sent['pageLimit'] === 200);
    }
}
