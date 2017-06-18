<?php
return [
    'default'     => env('APP_ENV', 'local'),
    'migrations' => 'migrations',
    'connections' => [
        'local' => [
            'driver'    => 'mysql',
            'host'      => 'db4free.net',
            'database'  => 'bddlumen',
            'username'  => 'blueiluminado',
            'password'  => 'azulzinho',
            'charset'   => 'utf8',
            'collation' => 'utf8_unicode_ci',
            'prefix'    => '',
            'strict'    => false,
        ],
        'testing' => [
            'driver'    => 'sqlite',
            'database' => env('DB_DATABASE', storage_path('database.sqlite')),
            'prefix'   => env('DB_PREFIX', ''),
        ],
        'sqlite' => [
            'driver'   => 'sqlite',
            'database' => env('DB_DATABASE', storage_path('database.sqlite')),
            'prefix'   => env('DB_PREFIX', ''),
        ],
    ],
];