<?php

/*
|--------------------------------------------------------------------------
| Application Routes
|--------------------------------------------------------------------------
|
| Here is where you can register all of the routes for an application.
| It is a breeze. Simply tell Lumen the URIs it should respond to
| and give it the Closure to call when that URI is requested.
|
*/

$app->get('/', function () use ($app) {
	$app_name = env('APP_NAME', 'site');
	$app_view = env('APP_VIEW', 'site');
    return view($app_view.'/index', ['app_name' => $app_name]);
});

$app->get('/admin/', function () use ($app) {
    return view('admin', ['app_name' => 'app de teste' , 'public' => '/adm/']);
});

$app->get('/admin/listar/{entidade}', function ($entidade) use ($app) {
    return view('admin', ['app_name' => 'app de teste' , 'public' => '/adm/' , 'entidade'=>$entidade]);
});

$app->get('/admin/editar/{entidade}', function ($entidade) use ($app) {
    return view('admin', ['app_name' => 'app de teste' , 'public' => '/adm/' , 'entidade'=>$entidade]);
});

$app->get('/admin/editar/{entidade}/{id}', function ($entidade , $id ) use ($app) {
    return view('admin', ['app_name' => 'app de teste' , 'public' => '/adm/' , 'entidade'=>$entidade, 'id'=>$id]);
});

$app->get('/app/', function () use ($app) {
    return view('app', ['app_name' => 'app de teste']);
});

$app->get('/api/', function () use ($app) {
    return 'retorno do teste de api';
});

$app->get('/site/', function () use ($app) {
    return 'retorno do teste de api';
});




/**
 * Routes for resource group
 */
$app->get('api/group', 'GroupsController@all');
$app->get('api/group/{id}', 'GroupsController@get');
$app->post('api/group', 'GroupsController@add');
$app->put('api/group/{id}', 'GroupsController@put');
$app->delete('api/group/{id}', 'GroupsController@remove');

/**
 * Routes for resource user
 */
$app->get('api/user', 'UsersController@all');
$app->get('api/user/{id}', 'UsersController@get');
$app->post('api/user', 'UsersController@add');
$app->put('api/user/{id}', 'UsersController@put');
$app->delete('api/user/{id}', 'UsersController@remove');

/**
 * Routes for resource store
 */
$app->get('api/store', 'StoresController@all');
$app->get('api/store/{id}', 'StoresController@get');
$app->post('api/store', 'StoresController@add');
$app->put('api/store/{id}', 'StoresController@put');
$app->delete('api/store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('api/categorie', 'CategoriesController@all');
$app->get('api/categorie/{id}', 'CategoriesController@get');
$app->post('api/categorie', 'CategoriesController@add');
$app->put('api/categorie/{id}', 'CategoriesController@put');
$app->delete('api/categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('api/sub-categorie', 'SubCategoriesController@all');
$app->get('api/sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('api/sub-categorie', 'SubCategoriesController@add');
$app->put('api/sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('api/sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('api/product', 'ProductsController@all');
$app->get('api/product/{id}', 'ProductsController@get');
$app->post('api/product', 'ProductsController@add');
$app->put('api/product/{id}', 'ProductsController@put');
$app->delete('api/product/{id}', 'ProductsController@remove');


/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource store
 */
$app->get('store', 'StoresController@all');
$app->get('store/{id}', 'StoresController@get');
$app->post('store', 'StoresController@add');
$app->put('store/{id}', 'StoresController@put');
$app->delete('store/{id}', 'StoresController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource sub-categorie
 */
$app->get('sub-categorie', 'SubCategoriesController@all');
$app->get('sub-categorie/{id}', 'SubCategoriesController@get');
$app->post('sub-categorie', 'SubCategoriesController@add');
$app->put('sub-categorie/{id}', 'SubCategoriesController@put');
$app->delete('sub-categorie/{id}', 'SubCategoriesController@remove');

/**
 * Routes for resource product
 */
$app->get('product', 'ProductsController@all');
$app->get('product/{id}', 'ProductsController@get');
$app->post('product', 'ProductsController@add');
$app->put('product/{id}', 'ProductsController@put');
$app->delete('product/{id}', 'ProductsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource content
 */
$app->get('content', 'ContentsController@all');
$app->get('content/{id}', 'ContentsController@get');
$app->post('content', 'ContentsController@add');
$app->put('content/{id}', 'ContentsController@put');
$app->delete('content/{id}', 'ContentsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource content
 */
$app->get('content', 'ContentsController@all');
$app->get('content/{id}', 'ContentsController@get');
$app->post('content', 'ContentsController@add');
$app->put('content/{id}', 'ContentsController@put');
$app->delete('content/{id}', 'ContentsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource content
 */
$app->get('content', 'ContentsController@all');
$app->get('content/{id}', 'ContentsController@get');
$app->post('content', 'ContentsController@add');
$app->put('content/{id}', 'ContentsController@put');
$app->delete('content/{id}', 'ContentsController@remove');

/**
 * Routes for resource user
 */
$app->get('user', 'UsersController@all');
$app->get('user/{id}', 'UsersController@get');
$app->post('user', 'UsersController@add');
$app->put('user/{id}', 'UsersController@put');
$app->delete('user/{id}', 'UsersController@remove');

/**
 * Routes for resource group
 */
$app->get('group', 'GroupsController@all');
$app->get('group/{id}', 'GroupsController@get');
$app->post('group', 'GroupsController@add');
$app->put('group/{id}', 'GroupsController@put');
$app->delete('group/{id}', 'GroupsController@remove');

/**
 * Routes for resource categorie
 */
$app->get('categorie', 'CategoriesController@all');
$app->get('categorie/{id}', 'CategoriesController@get');
$app->post('categorie', 'CategoriesController@add');
$app->put('categorie/{id}', 'CategoriesController@put');
$app->delete('categorie/{id}', 'CategoriesController@remove');

/**
 * Routes for resource content
 */
$app->get('content', 'ContentsController@all');
$app->get('content/{id}', 'ContentsController@get');
$app->post('content', 'ContentsController@add');
$app->put('content/{id}', 'ContentsController@put');
$app->delete('content/{id}', 'ContentsController@remove');
