<?php

use Illuminate\Database\Schema\Blueprint;
use Illuminate\Database\Migrations\Migration;

class CreateGroupsTable extends Migration
{

    public function up()
    {
        Schema::create('groups', function(Blueprint $table) {
            $table->increments('id');
            $table->string('name');
            $table->text('desc')->nullable();
            // Constraints declaration
            $table->timestamps();
        });
    }

    public function down()
    {
        Schema::drop('groups');
    }
}
