<?php
return [
    'default'     => env('APP_ENV', 'local'),
    'migrations' => 'migrations',
    'connections' => [
        'local' => [
            'driver'    => 'sqlite',
            'database' => env('DB_DATABASE', storage_path('dev.sqlite')),
            'prefix'   => env('DB_PREFIX', ''),
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