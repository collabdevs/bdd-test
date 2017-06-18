<?php namespace App;

use Illuminate\Database\Eloquent\Model;

class Categorie extends Model {

    protected $fillable = ["name", "desc"];

    protected $dates = [];

    public static $rules = [
        "name" => "required|min:3",
    ];

    public $timestamps = false;

    public function sub_categories()
    {
        return $this->hasMany("App\Sub_category");
    }


}
