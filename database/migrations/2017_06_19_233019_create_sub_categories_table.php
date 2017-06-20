<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class CreateSubCategoriesTable extends Migration
{

    public function up()
    {
        Schema::create('sub_categories', function(Blueprint $table) {
            $table->increments('id');
            $table->string('name', 50)->unique();
            $table->text('desc')->nullable();
            $table->integer('categorie_id')->unsigned();
            $table->foreign('categorie_id')
                ->references('id')
                ->on('categories');

        });
    }

    public function down()
    {
        Schema::drop('sub_categories');
    }
}
