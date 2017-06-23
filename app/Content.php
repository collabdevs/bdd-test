<?php namespace App;

use Illuminate\Database\Eloquent\Model;

class Content extends Model {

    use \Illuminate\Database\Eloquent\SoftDeletes;

    protected $fillable = ["name", "desc", "published_at", "user_id", "categorie_id"];

    protected $dates = ["published_at"];

    public static $rules = [
        "name" => "required",
        "published_at" => "date",
        "user_id" => "numeric",
        "categorie_id" => "required|numeric",
    ];

    public function categorie()
    {
        return $this->belongsTo("App\Categorie");
    }


}
