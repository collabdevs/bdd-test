<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class CreateCategoriesTable extends Migration
{

    public function up()
    {
        Schema::create('categories', function(Blueprint $table) {
            $table->increments('id');
            $table->string('name', 50)->unique();
            $table->text('desc')->nullable();
            // Constraints declaration

        });
    }

    public function down()
    {
        Schema::drop('categories');
    }
}
