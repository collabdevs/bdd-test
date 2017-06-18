<?php namespace App;

use Illuminate\Database\Eloquent\Model;

class Store extends Model {

    protected $fillable = ["name"];

    protected $dates = [];

    public static $rules = [
        "name" => "required|min:3",
    ];

    public $timestamps = false;

    public function products()
    {
        return $this->hasMany("App\Product");
    }


}
