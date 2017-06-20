<?php
require 'vendor/autoload.php';
use Symfony\Component\Yaml\Parser;

$yaml = new Parser();

$value = $yaml->parse( file_get_contents( 'Store.yml', 1 ) );

print_r($value);